// ENSEMBLE COMPOSER. A complete piece is planned before a single note is written:
//
//   1. settings resolved — key, scale, meter, tempo, length (bars or a duration), form;
//   2. lineup and roles (instruments domain);
//   3. form → sections → phrases with cadences (arrangement domain);
//   4. each section's harmonic language and tonal centre, then its chord timeline (harmony);
//   5. themes: A invented, B its contrast, later letters derived (melody);
//   6. orchestration: who plays, who carries the line, entrances, exits, imitation (arrangement);
//   7. every section written part by part by one Writer (shared with the endless performer):
//      the carrier's melody first, then its imitations, then parts that react to it, then the
//      accompaniment, ostinatos and colour;
//   8. polish: consonance across the ensemble, playable constraints, dynamics, humanisation.
//
// Every random decision comes from a seeded stream forked by (domain, track seed, variation,
// section, technique), so the same settings and seeds reproduce the same piece exactly, and
// regenerating one domain or one track leaves the others as they were. Locks keep material from a
// previous composition: harmony (the chord timeline), melody (the carrier lines), rhythm (every
// part's onsets — pitches re-fitted to the new harmony), arrangement (form and orchestration),
// instruments (lineup, roles and sound), and individual tracks (verbatim notes).

import { adaptNotes, musicalContext, nearestChordTone, type MusicalContext } from "../theory/context";
import { barBeats } from "../theory/meter";
import { retargetSlots } from "../theory/progression";
import { hash32, rng, type Rng } from "../theory/rng";
import { isMinorish, scaleIntervals, snapToScale } from "../theory/scales";
import type { Beats, ChordSlot, MeterId, ScaleId } from "../theory/types";
import { clamp } from "../utils/math";
import { autoForm, planForm } from "./form";
import { sectionHarmony } from "./harmony";
import { partRange } from "./instruments";
import { orchestrate } from "./orchestration";
import { writeArpeggio, writeBass, writeBordun, writeHarmony } from "./parts/accompaniment";
import { writeExperimental, writePunctuation, writeTexture } from "./parts/colour";
import { newMemory, type PartEnv, type SectionShared, type TrackMemory } from "./parts/common";
import { writeCounter } from "./parts/counter";
import { carrierShare, writeDerived, writeImitation } from "./parts/imitation";
import { writeMelody } from "./parts/melody";
import { writeOstinato } from "./parts/ostinato";
import { applyConstraints, consonancePass, finishTrack, priorityOf, type PolishStats, type WrittenPart } from "./polish";
import { bordunWeights, entries, getProfile, languageWeights, type Profile } from "./profiles";
import { buildTracks } from "./roles";
import { contrastTheme, deriveTheme, inventTheme, themeBars } from "./themes";
import type { BordunType, Composition, ComposeControls, ComposeSettings, Draft, HarmonyLanguage, Locks, MasterSettings, NoteEvent, Plan, Section, Seeds, ThemeRecord, Track } from "./types";

export const DEFAULT_CONTROLS: ComposeControls = {
  density: 0.5, harmonicComplexity: 0.45, rhythmicComplexity: 0.45, counterpoint: 0.5, motifVariation: 0.5,
  evolution: 0.5, humanize: 0.35, arrangementDensity: 0.55, dissonance: 0.25,
};

export function defaultSettings(): ComposeSettings {
  return {
    mode: "arrangement", profile: "traditional", key: "auto", scale: "auto", meter: "auto", bpm: "auto", form: "auto",
    lengthMode: "bars", bars: 64, seconds: 150, instruments: 8, realism: "orff", controls: { ...DEFAULT_CONTROLS },
  };
}

export const NO_LOCKS: Locks = { harmony: false, rhythm: false, melody: false, arrangement: false, instruments: false };

export function seedsFrom(master: number): Seeds {
  const m = master >>> 0;
  return { master: m, arrangement: hash32(`${m}:arrangement`), harmony: hash32(`${m}:harmony`), melody: hash32(`${m}:melody`), rhythm: hash32(`${m}:rhythm`), instruments: hash32(`${m}:instruments`) };
}

/** New seeds for every unlocked domain; locked domains keep theirs. */
export function reseed(old: Seeds, master: number, locks: Locks): Seeds {
  const fresh = seedsFrom(master);
  return {
    master: fresh.master,
    arrangement: locks.arrangement ? old.arrangement : fresh.arrangement,
    harmony: locks.harmony ? old.harmony : fresh.harmony,
    melody: locks.melody ? old.melody : fresh.melody,
    rhythm: locks.rhythm ? old.rhythm : fresh.rhythm,
    instruments: locks.instruments ? old.instruments : fresh.instruments,
  };
}

export function defaultMaster(profile: Profile): MasterSettings {
  return { gain: 0.9, reverbSize: profile.id === "ambient" ? 0.7 : 0.5, reverbDecay: profile.id === "ambient" ? 0.62 : 0.42, delayBeats: profile.id === "ambient" ? 1.5 : 0.75, delayFeedback: 0.32 };
}

const KEY_PREFS_MAJOR: [number, number][] = [[0, 4], [5, 3], [7, 3], [2, 1.2], [10, 0.6], [3, 0.4]];
const KEY_PREFS_MINOR: [number, number][] = [[9, 4], [2, 3], [4, 2.5], [7, 1], [0, 0.8], [5, 0.5]];

export function autoKey(profile: Profile, scale: ScaleId, r: Rng): number {
  // Orff barred instruments are in C with F♯ and B♭ bars: elemental pieces sit in C, F, G (or the
  // relative minors A, D, E) — the keys the instruments are built for
  const prefs = isMinorish(scale) ? KEY_PREFS_MINOR : KEY_PREFS_MAJOR;
  const all = profile.id === "traditional" ? prefs.slice(0, 3) : prefs;
  if (profile.id === "experimental" || profile.id === "ambient") return r.int(0, 11);
  return r.weighted(all.map((x) => x[0]), all.map((x) => x[1]));
}

function weighted<T extends string>(w: Partial<Record<T, number>>, r: Rng): T {
  const { items, weights } = entries(w);
  return r.weighted(items, weights);
}

/** Domain stream for one technique on one track in one section. */
export function partRng(domainSeed: number, track: Track, sectionIndex: number, technique: string): Rng {
  return rng(hash32(`${domainSeed}:${track.seed}:${track.variation}:${sectionIndex}:${technique}`));
}

const MELODIC_TECHNIQUES = new Set(["melody", "imitate", "counter", "parallel", "texture"]);

/** Order in which parts are written inside a section: what others react to comes first. */
const WRITE_ORDER = ["melody", "imitate", "counter", "parallel", "bass", "bordun", "harmony", "arpeggio", "ostinato", "texture", "punctuation", "experimental"];

export interface WriterInput {
  plan: Plan;
  tracks: Track[];
  profile: Profile;
  settings: ComposeSettings;
  seeds: Seeds;
  locks: Locks;
  previous: Composition | null;
  pieceEnd: Beats;
}

/** Writes sections. Keeps each track's memory (cells, voicings, last pitches) across sections so
 *  refrains return with their own ostinatos and voice leading continues over section joins. */
export class Writer {
  readonly memories = new Map<string, TrackMemory>();
  private ctxCache = new Map<number, MusicalContext>();

  constructor(private w: WriterInput) {
    for (const t of w.tracks) this.memories.set(t.id, newMemory());
  }

  ctxFor(sec: Section): MusicalContext {
    let c = this.ctxCache.get(sec.index);
    if (!c) {
      c = musicalContext({ key: sec.key, scale: sec.scale, custom: this.w.plan.custom, meter: this.w.plan.meter, behavior: this.w.plan.behavior, slots: this.w.plan.harmony });
      this.ctxCache.set(sec.index, c);
    }
    return c;
  }

  resetContext(): void {
    this.ctxCache.clear();
  }

  writeSection(sec: Section): WrittenPart[] {
    const { plan, tracks, profile, settings, seeds, locks, previous } = this.w;
    const bb = barBeats(plan.meter);
    const start = sec.startBar * bb;
    const end = (sec.startBar + sec.bars) * bb;
    const ctx = this.ctxFor(sec);
    const shared: SectionShared = { carrierLine: [], carrierFull: [], ostinatoRhythms: [], cycles: [], echoUnits: [] };
    const out: WrittenPart[] = [];
    const prevTrack = (id: string) => previous?.tracks.find((t) => t.id === id);
    // a note belongs to the section its written (grid) position falls in, whatever humanisation did
    const grid = (b: number) => Math.round(b * 24) / 24;
    const prevNotes = (id: string): Draft[] =>
      (prevTrack(id)?.notes ?? []).filter((n) => grid(n.start) >= start - 1e-6 && grid(n.start) < end - 1e-6).map((n) => ({ start: n.start, dur: n.dur, midi: n.midi, vel: n.vel, motif: n.motif, tag: n.tag, fixed: true }));
    const followers = sec.imitation.followers;
    const melodyIds = new Set([sec.carrier, ...followers].filter((x): x is string => !!x));

    const envFor = (t: Track, technique: string): PartEnv => {
      const [lo, hi] = partRange(t.instrumentId, t.role === "melody" || technique === "melody" ? "melody" : t.role, settings.realism);
      const domain = MELODIC_TECHNIQUES.has(technique.split(":")[0]) ? seeds.melody : seeds.rhythm;
      return {
        plan, sec, ctx, bb, start, end, pieceEnd: this.w.pieceEnd, bpm: plan.bpm, profile, controls: settings.controls, realism: settings.realism,
        track: t, part: sec.parts[t.id], lo, hi, r: partRng(domain, t, sec.index, technique),
        themeRng: (theme, label) => rng(hash32(`${seeds.melody}:${t.seed}:${t.variation}:${theme}:${label}`)),
        hold: locks.rhythm,
        memory: this.memories.get(t.id) ?? newMemory(), shared, tracks, themes: plan.themes,
      };
    };

    const order = tracks
      .map((t) => ({ t, tech: sec.parts[t.id]?.technique ?? null }))
      .filter((x) => x.tech)
      .map((x) => ({ ...x, key: x.t.id === sec.carrier ? "melody" : x.tech!.split(":")[0] }))
      .sort((a, b) => WRITE_ORDER.indexOf(a.key) - WRITE_ORDER.indexOf(b.key));

    for (const { t, tech, key } of order) {
      const technique = tech!;
      let drafts: Draft[];
      const lockedTrack = t.locked && prevTrack(t.id);
      const melodyLocked = locks.melody && previous && melodyIds.has(t.id) && prevNotes(t.id).length > 0;
      // under a rhythm lock the kept onsets are already the carrier's share of a split line
      let alreadyShared = false;
      if (lockedTrack || melodyLocked) drafts = prevNotes(t.id);
      else {
        const env = envFor(t, technique);
        drafts = this.writePart(env, key, technique, sec, followers);
        if (locks.rhythm && previous) {
          const old = prevNotes(t.id);
          if (old.length) alreadyShared = true;
          drafts = reRhythm(old, drafts, ctx);
        }
      }
      if (key === "melody") {
        // the carrier's whole line is what imitations and counter-melodies work from
        const full = lockedTrack || melodyLocked ? [...drafts, ...followers.flatMap((f) => prevNotes(f))].sort((a, b) => a.start - b.start) : drafts;
        shared.carrierFull = full;
        shared.carrierLine = full;
        if (!(lockedTrack || melodyLocked || alreadyShared)) drafts = carrierShare(sec.imitation.kind, drafts, { sec, bb }, followers.length);
      }
      out.push({ trackId: t.id, sectionIndex: sec.index, technique: key === "melody" ? "melody" : technique, priority: priorityOf(key === "melody" ? "melody" : technique, Boolean(lockedTrack)), locked: Boolean(lockedTrack), drafts });
    }
    return out;
  }

  private writePart(env: PartEnv, key: string, technique: string, sec: Section, followers: string[]): Draft[] {
    switch (key) {
      case "melody":
        return sec.theme ? writeMelody(env, sec.theme, { echoGap: sec.imitation.kind === "echo" && followers.length > 0 }) : [];
      case "imitate": {
        const kind = technique.split(":")[1] as Section["imitation"]["kind"];
        return writeImitation(env, kind, Math.max(0, followers.indexOf(env.track.id)), followers.length);
      }
      case "counter":
        return writeCounter(env);
      case "parallel":
        return env.shared.carrierFull.length ? writeDerived(env, env.controls.counterpoint < 0.3 ? "heterophony" : "parallel") : [];
      case "bass":
        return writeBass(env);
      case "bordun": {
        const letter = sec.theme ?? sec.fn;
        let type = env.memory.borduns[letter] as BordunType | undefined;
        if (!type || (sec.variant > 0 && env.r.chance(0.35 + env.controls.evolution * 0.3))) type = weighted(bordunWeights(env.profile, sec.fn), env.r);
        env.memory.borduns[letter] = type;
        return writeBordun(env, type);
      }
      case "harmony":
        return writeHarmony(env);
      case "arpeggio":
        return writeArpeggio(env);
      case "ostinato":
        return writeOstinato(env);
      case "texture":
        return writeTexture(env);
      case "punctuation":
        return writePunctuation(env);
      case "experimental":
        return writeExperimental(env);
      default:
        return [];
    }
  }
}

/** Rhythm lock: keep the previous onsets and lengths of a part; take each onset's pitch from the
 *  newly written part (the notes sounding there, or the nearest), then fit exposed notes to the
 *  harmony. Notes struck together (a dyad, a chord) are mapped rank by rank onto distinct new
 *  voices, so a kept chord rhythm stays a chord. A part that was silent before keeps its new notes. */
export function reRhythm(old: Draft[], fresh: Draft[], ctx: MusicalContext): Draft[] {
  if (!old.length || !fresh.length) return fresh;
  const groups: Draft[][] = [];
  for (const o of [...old].sort((a, b) => a.start - b.start || a.midi - b.midi)) {
    const g = groups[groups.length - 1];
    if (g && Math.abs(g[0].start - o.start) < 0.02) g.push(o);
    else groups.push([o]);
  }
  const out: Draft[] = [];
  for (const g of groups) {
    const t = g[0].start;
    let cands = fresh.filter((f) => f.start <= t + 1e-6 && f.start + f.dur > t);
    if (!cands.length) {
      const nearest = fresh.reduce((a, b) => (Math.abs(b.start - t) < Math.abs(a.start - t) ? b : a));
      cands = fresh.filter((f) => Math.abs(f.start - nearest.start) < 0.02);
    }
    const pitches = [...new Set(cands.map((c) => c.midi))].sort((a, b) => a - b);
    const used = new Set<number>();
    g.forEach((o, i) => {
      const k = g.length === 1 ? pitches.length - 1 : Math.round((i * (pitches.length - 1)) / (g.length - 1));
      let m = pitches[Math.max(0, k)];
      if (used.has(m)) m = nearestChordTone(ctx, o.midi, t, 0, "harmony");
      if (used.has(m)) return;
      used.add(m);
      const src = cands.find((c) => c.midi === m) ?? cands[0];
      out.push({ ...o, midi: m, tag: src?.tag ?? o.tag, motif: src?.motif ?? o.motif, fixed: true });
    });
  }
  return adaptNotes(ctx, out, "guided", 0.6);
}

// ------------------------------------------------------------------ composition

export interface ComposeInput {
  settings: ComposeSettings;
  seeds: Seeds;
  locks?: Locks;
  previous?: Composition | null;
  name?: string;
  master?: MasterSettings;
}

export interface ComposeResult {
  composition: Composition;
  notices: string[];
  stats: PolishStats;
}

export function resolvePlanBasics(settings: ComposeSettings, seeds: Seeds, locks: Locks, prev: Composition | null, profile: Profile) {
  const scale: ScaleId = settings.scale !== "auto" ? settings.scale : locks.harmony && prev ? prev.plan.scale : weighted(profile.scales, rng(hash32(`${seeds.harmony}:scale`)));
  const key = settings.key !== "auto" ? settings.key : locks.harmony && prev && prev.plan.scale === scale ? prev.plan.key : autoKey(profile, scale, rng(hash32(`${seeds.harmony}:key`)));
  // a chord timeline, a melody and a rhythm are all laid out in bars: any of those locks holds the meter
  const holdsMeter = locks.rhythm || locks.arrangement || locks.harmony || locks.melody;
  const meter: MeterId = settings.meter !== "auto" ? settings.meter : prev && holdsMeter ? prev.plan.meter : weighted(profile.meters, rng(hash32(`${seeds.rhythm}:meter`)));
  const tr = rng(hash32(`${seeds.rhythm}:tempo`));
  const bpm = typeof settings.bpm === "number" ? clamp(settings.bpm, 30, 240) : prev && locks.rhythm ? prev.plan.bpm : Math.round(profile.tempo[0] + tr() * (profile.tempo[1] - profile.tempo[0]));
  const bb = barBeats(meter);
  const bars = settings.lengthMode === "duration" ? clamp(Math.round((settings.seconds * bpm) / 60 / bb), 4, 512) : clamp(Math.round(settings.bars), 4, 512);
  return { scale, key, meter, bpm, bars, bb };
}

/** Tonal centre for a section: contrast may move to the relative mode on the same pitch set
 *  (do-pentatonic ↔ la-pentatonic, major ↔ minor) or to a related key; a cinematic climax may lift. */
function sectionTonality(sec: Section, plan: Pick<Plan, "key" | "scale">, profile: Profile, r: Rng): { key: number; scale: ScaleId } {
  const home = { key: plan.key, scale: plan.scale };
  if (sec.fn === "contrast" || (sec.fn === "development" && profile.id === "cinematic")) {
    if (profile.contrastKey === "relative" || profile.contrastKey === "related") {
      const rel: Partial<Record<ScaleId, [number, ScaleId]>> = { majorPent: [9, "minorPent"], minorPent: [3, "majorPent"], major: [9, "minor"], minor: [3, "major"], dorian: [10, "lydian"], mixolydian: [5, "major"] };
      const x = rel[plan.scale];
      if (x && r.chance(profile.contrastKey === "relative" ? 0.6 : 0.5)) return { key: (plan.key + x[0]) % 12, scale: x[1] };
      if (profile.contrastKey === "related" && r.chance(0.4)) return { key: (plan.key + 7) % 12, scale: plan.scale };
    }
  }
  if (profile.id === "cinematic" && sec.fn === "climax" && sec.variant > 0 && r.chance(0.5)) return { key: (plan.key + 2) % 12, scale: plan.scale };
  return home;
}

export function compose(input: ComposeInput): ComposeResult {
  const settings = input.settings;
  const seeds = input.seeds;
  const locks = input.locks ?? NO_LOCKS;
  const prev = input.previous ?? null;
  const profile = getProfile(settings.profile);
  const notices: string[] = [];
  const { scale, key, meter, bpm, bars, bb } = resolvePlanBasics(settings, seeds, locks, prev, profile);
  const custom: number[] | undefined = undefined;

  // ---- instruments
  const instrRng = rng(seeds.instruments);
  let tracks: Track[] =
    locks.instruments && prev
      ? prev.tracks.map((t) => ({ ...t, notes: t.notes }))
      : buildTracks(profile, settings.instruments, instrRng, prev?.tracks ?? []);
  // a key or scale change carries locked material with it
  const keyShift = prev && prev.plan.key !== key ? ((key - prev.plan.key + 18) % 12) - 6 : 0;
  const scaleChanged = prev && prev.plan.scale !== scale;
  let previous = prev;
  if (prev && (keyShift || scaleChanged)) {
    previous = {
      ...prev,
      plan: { ...prev.plan, key, scale, harmony: retargetSlots(prev.plan.harmony, { key: prev.plan.key, scale: prev.plan.scale }, { key, scale }) },
      tracks: prev.tracks.map((t) => ({ ...t, notes: t.notes.map((n) => ({ ...n, midi: scaleChanged ? snapToScale(n.midi + keyShift, key, scale) : n.midi + keyShift })) })),
    };
    if (prev.tracks.some((t) => t.locked) || locks.melody || locks.harmony) notices.push(keyShift ? "Locked material was transposed to the new key." : "Locked material was fitted to the new scale.");
  }
  tracks = tracks.map((t) => {
    const p = previous?.tracks.find((x) => x.id === t.id);
    return t.locked && p ? { ...t, notes: p.notes } : t;
  });

  // ---- form and sections
  const arrRng = rng(seeds.arrangement);
  const harmRng = rng(seeds.harmony);
  const sameFrame = !!previous && previous.plan.bars === bars && previous.plan.meter === meter;
  let sections: Section[];
  let form = settings.form !== "auto" ? settings.form : previous && locks.arrangement && sameFrame ? previous.plan.form : autoForm(profile.id, bars, arrRng.fork("form"));
  const reuseSections = locks.arrangement && previous && sameFrame;
  if (locks.arrangement && previous && !sameFrame) notices.push("The arrangement lock was released: the length or meter changed.");
  if (reuseSections) {
    sections = structuredClone(previous!.plan.sections);
    form = previous!.plan.form;
  } else {
    const skel = planForm(form, bars, profile, settings.controls, arrRng.fork("plan"));
    const langByLetter = new Map<string, HarmonyLanguage>();
    sections = skel.map((s, i) => {
      let language = weighted(languageWeights(profile, s.fn), harmRng.fork(`lang:${i}`));
      if (s.theme && langByLetter.has(s.theme) && s.fn !== "climax" && s.fn !== "development") language = langByLetter.get(s.theme)!;
      if (s.theme && !langByLetter.has(s.theme)) langByLetter.set(s.theme, language);
      const sec: Section = { ...s, index: i, language, key, scale, carrier: null, imitation: { kind: "none", followers: [], offsetBars: 1, interval: 0 }, parts: {} };
      const tone = sectionTonality(sec, { key, scale }, profile, harmRng.fork(`tonality:${i}`));
      sec.key = tone.key;
      sec.scale = tone.scale;
      return sec;
    });
  }
  const tb = themeBars(profile.motif, meter);
  const rolesChanged = !previous || previous.tracks.length !== tracks.length || previous.tracks.some((t, i) => t.role !== tracks[i]?.role || t.id !== tracks[i]?.id);
  if (!reuseSections || rolesChanged) orchestrate({ sections, tracks, profile, controls: settings.controls, form, realism: settings.realism, themeBars: tb, phraseBars: profile.phraseBars }, arrRng.fork("orchestrate"));

  // ---- themes
  const melRng = rng(seeds.melody);
  const themeOpts = { grammar: profile.motif, meter, scale, custom, complexity: settings.controls.rhythmicComplexity };
  let themes: Record<string, ThemeRecord> = {};
  if (locks.melody && previous && previous.plan.meter === meter) themes = structuredClone(previous.plan.themes);
  const letters = [...new Set(sections.map((s) => s.theme).filter((x): x is string => !!x))];
  for (const L of letters) {
    if (themes[L]) continue;
    const r = melRng.fork(`theme:${L}`);
    if (L === "A" || !themes.A) themes[L] = inventTheme(L, r, themeOpts);
    else if (form === "through" || form === "arch") {
      const before = letters[letters.indexOf(L) - 1];
      themes[L] = deriveTheme(L, themes[before] ?? themes.A, r, themeOpts);
    } else themes[L] = contrastTheme(L, themes.A, r, themeOpts);
  }

  const plan: Plan = { profile: profile.id, form, key, scale, custom, meter, bpm, bars, phraseBars: profile.phraseBars, behavior: behaviorFor(profile, settings.controls), sections, harmony: [], themes };

  // ---- harmony
  if (locks.harmony && previous && sameFrame) plan.harmony = previous.plan.harmony;
  else {
    if (locks.harmony && previous) notices.push("The harmony lock was released: the length or meter changed.");
    const melodyWeight = locks.melody && previous ? melodyWeights(previous, plan) : undefined;
    let prevSlot: ChordSlot | null = null;
    const firstStatement = new Map<string, Section>();
    for (const sec of sections) {
      const hr = harmRng.fork(`harmony:${sec.index}`);
      const first = sec.theme ? firstStatement.get(sec.theme) : undefined;
      // a refrain returns with its own harmony (a climax may reharmonise it)
      const reuse = first && sec.variant <= 1 && first.key === sec.key && first.scale === sec.scale && first.language === sec.language && !(sec.fn === "climax" && hr.chance(settings.controls.motifVariation * 0.5));
      const slots: ChordSlot[] = reuse ? reuseHarmony(plan.harmony, first!, sec, bb) : sectionHarmony(sec, { meter, behavior: plan.behavior, profile, controls: settings.controls, custom, melodyWeight }, prevSlot, hr);
      plan.harmony.push(...slots);
      prevSlot = slots[slots.length - 1] ?? prevSlot;
      if (sec.theme && !first) firstStatement.set(sec.theme, sec);
    }
  }

  // ---- write
  const pieceEnd = bars * bb;
  const writer = new Writer({ plan, tracks, profile, settings, seeds, locks, previous, pieceEnd });
  const parts: WrittenPart[] = [];
  for (const sec of sections) parts.push(...writer.writeSection(sec));

  // ---- polish
  const stats = consonancePass(parts, tracks, plan, (i) => writer.ctxFor(sections[i]), settings.controls, settings.realism);
  const finished = finishParts(parts, tracks, plan, settings, seeds, profile, stats);

  const composition: Composition = {
    format: "glockwork-ensemble",
    version: 1,
    name: input.name ?? prev?.name ?? "Untitled ensemble",
    settings,
    seeds,
    locks,
    plan,
    tracks: tracks.map((t) => ({ ...t, notes: finished.get(t.id) ?? [] })),
    master: input.master ?? prev?.master ?? defaultMaster(profile),
  };
  return { composition, notices, stats };
}

export function behaviorFor(profile: Profile, controls: ComposeControls): Plan["behavior"] {
  if (profile.behavior === "strict" && controls.dissonance > 0.6 && profile.id !== "traditional") return "expressive";
  if (profile.behavior === "expressive" && controls.dissonance > 0.85) return "experimental";
  return profile.behavior;
}

/** Constraints, dynamics and humanisation for every track; locked tracks pass through untouched. */
export function finishParts(parts: WrittenPart[], tracks: Track[], plan: Plan, settings: ComposeSettings, seeds: Seeds, profile: Profile, stats: PolishStats): Map<string, NoteEvent[]> {
  const out = new Map<string, NoteEvent[]>();
  const bb = barBeats(plan.meter);
  for (const t of tracks) {
    const mine = parts.filter((p) => p.trackId === t.id);
    if (t.locked && mine.length && mine.every((p) => p.locked) && mine[0].technique !== "held") {
      out.set(t.id, (out.get(t.id) ?? []).concat(t.notes));
      continue;
    }
    const drafts = mine.flatMap((p) => p.drafts);
    const constrained = applyConstraints(t, drafts, plan, settings.realism, stats);
    const enter = new Map<number, Beats>();
    for (const p of mine) {
      const sec = plan.sections.find((x) => x.index === p.sectionIndex);
      if (sec) enter.set(sec.index, (sec.startBar + (sec.parts[t.id]?.enterBar ?? 0)) * bb);
    }
    out.set(t.id, finishTrack(t, constrained, plan, settings.controls, seeds.rhythm, profile.id, enter));
  }
  return out;
}

/** Copy a first statement's chords onto a return, phrase by phrase: each phrase of the return takes
 *  the chords of the original phrase in the same position with the same cadence (so a return that
 *  ends open still ends open), stretched or clipped to the phrase's length. */
export function reuseHarmony(timeline: ChordSlot[], first: Section, sec: Section, bb: Beats): ChordSlot[] {
  const out: ChordSlot[] = [];
  sec.phrases.forEach((ph, k) => {
    const same = first.phrases.map((p, i) => ({ p, i })).filter((x) => x.p.cadence === ph.cadence);
    const src = (same.length ? same[k % same.length] : { p: first.phrases[k % first.phrases.length] }).p;
    const s0 = src.startBar * bb;
    const s1 = (src.startBar + src.bars) * bb;
    const t0 = ph.startBar * bb;
    const t1 = (ph.startBar + ph.bars) * bb;
    const shift = t0 - s0;
    const inSrc = timeline.filter((s) => s.start < s1 - 1e-6 && s.start + s.dur > s0 + 1e-6);
    inSrc.forEach((s, i) => {
      const start = Math.max(t0, s.start + shift);
      const end = i === inSrc.length - 1 ? t1 : Math.min(t1, s.start + s.dur + shift);
      if (end > start + 1e-6) out.push({ ...s, start, dur: end - start });
    });
  });
  return out;
}

/** Strong-beat pitch-class weights of the previous composition's carrier lines (for harmonising a
 *  locked melody). */
function melodyWeights(prev: Composition, plan: Plan): (from: Beats, to: Beats) => Map<number, number> {
  const bb = barBeats(plan.meter);
  const lines: NoteEvent[] = [];
  for (const sec of prev.plan.sections) {
    const ids = [sec.carrier, ...sec.imitation.followers].filter((x): x is string => !!x);
    const s = sec.startBar * bb;
    const e = (sec.startBar + sec.bars) * bb;
    for (const id of ids) lines.push(...(prev.tracks.find((t) => t.id === id)?.notes ?? []).filter((n) => n.start >= s && n.start < e));
  }
  return (from, to) => {
    const m = new Map<number, number>();
    for (const n of lines) {
      if (n.start < from - 1e-6 || n.start >= to - 1e-6) continue;
      const pos = ((n.start % bb) + bb) % bb;
      const w = (pos < 1e-6 ? 1 : Math.abs(pos - bb / 2) < 1e-6 ? 0.7 : 0.3) * Math.min(2, n.dur);
      const pc = ((n.midi % 12) + 12) % 12;
      m.set(pc, (m.get(pc) ?? 0) + w);
    }
    return m;
  };
}

export const scaleSize = (s: ScaleId) => scaleIntervals(s).length;
