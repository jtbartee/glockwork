// ENDLESS PERFORMANCE. The same composer, unrolled: instead of planning a whole form and writing it,
// the performer plans a "chapter" (a few sections) at a time, ahead of the playhead, and writes it
// with the same Writer, harmony planner, orchestration and polish as a finished arrangement.
//
// A walker chooses what comes next — exposition, contrast, development, interlude, return, climax,
// new material — following a long-range intensity wave (two slow sinusoids, so it never settles into
// a loop), with rules a composer would keep: no two climaxes in a row, a quiet interlude after a peak,
// the main theme recalled every few sections, new themes introduced (derived from old ones) as the
// evolution control allows. At chapter boundaries the tonal centre may move to a related key (the
// relative mode on the same bars, the dominant, the subdominant) and is drawn back home after a
// while. Memory: a refrain returns with its own harmony and ostinato; old themes resurface later.
//
// Everything is seeded: chapter k is planned from fork(seed, k) and the state the earlier chapters
// left, so an endless performance is exactly reproducible from its seed. Material far behind the
// playhead is trimmed to keep memory bounded; any span can be captured as an editable arrangement.
//
// Locks: harmony freezes the tonal centre and cycles the last harmony; melody stops new themes and
// repeats statements literally; rhythm stops ostinato mutation; arrangement repeats the last
// chapter's shape; instruments freeze who plays; a locked track repeats its last section.

import { barBeats } from "../theory/meter";
import { retargetSlots } from "../theory/progression";
import { hash32, rng, type Rng } from "../theory/rng";
import type { Beats, ChordSlot, ScaleId } from "../theory/types";
import { behaviorFor, defaultMaster, finishParts, resolvePlanBasics, reuseHarmony, Writer } from "./composer";
import { phrasePlan } from "./form";
import { sectionHarmony } from "./harmony";
import { newOrchestrationState, orchestrate, type OrchestrationState } from "./orchestration";
import { consonancePass, type Accepted, type PolishStats, soundingEnd } from "./polish";
import { getProfile, languageWeights, entries, type Profile } from "./profiles";
import { buildTracks } from "./roles";
import { contrastTheme, deriveTheme, inventTheme, themeBars, type ThemeOptions } from "./themes";
import { dampsAtNoteEnd, ringSeconds } from "./instruments";
import type { ComposeSettings, Composition, HarmonyLanguage, Locks, NoteEvent, Plan, Section, SectionFn, Seeds, Track } from "./types";

type Chapter = "exposition" | "contrast" | "development" | "interlude" | "return" | "climax" | "new";

const RELATIVE: Partial<Record<ScaleId, [number, ScaleId]>> = { majorPent: [9, "minorPent"], minorPent: [3, "majorPent"], major: [9, "minor"], minor: [3, "major"], dorian: [10, "lydian"], lydian: [2, "dorian"], mixolydian: [5, "major"] };

export interface EndlessStatus {
  sections: number;
  chapters: number;
  bars: number;
  key: number;
  scale: ScaleId;
  lastChapter: Chapter | null;
}

export class EndlessComposer {
  readonly composition: Composition;
  private profile: Profile;
  private writer: Writer;
  private orch: OrchestrationState = newOrchestrationState();
  private chapter = 0;
  private lastKind: Chapter | null = null;
  private sinceReturn = 0;
  private sinceNew = 0;
  private home: { key: number; scale: ScaleId };
  private centre: { key: number; scale: ScaleId };
  private awayFor = 0;
  private firstStatement = new Map<string, Section>();
  private themeOrder: string[] = [];
  private prevSlot: ChordSlot | null = null;
  private lastShape: SectionFn[] = [];
  private tail: Accepted[] = [];
  readonly stats: PolishStats = { checked: 0, moved: 0, dropped: 0, kept: 0, intentional: 0, rangeFolded: 0, malletTrimmed: 0, speedTrimmed: 0 };

  constructor(private settings: ComposeSettings, private seeds: Seeds, private locks: Locks, base: Composition | null = null) {
    this.profile = getProfile(settings.profile);
    const basics = resolvePlanBasics({ ...settings, lengthMode: "bars", bars: 64 }, seeds, locks, base, this.profile);
    const tracks: Track[] = locks.instruments && base ? base.tracks.map((t) => ({ ...t, notes: [] })) : buildTracks(this.profile, settings.instruments, rng(seeds.instruments), base?.tracks ?? []).map((t) => ({ ...t, notes: [] }));
    this.home = { key: basics.key, scale: basics.scale };
    this.centre = { ...this.home };
    const plan: Plan = {
      profile: this.profile.id, form: "through", key: basics.key, scale: basics.scale, meter: basics.meter, bpm: basics.bpm, bars: 0,
      phraseBars: this.profile.phraseBars, behavior: behaviorFor(this.profile, settings.controls), sections: [], harmony: [], themes: {},
    };
    this.composition = {
      format: "glockwork-ensemble", version: 1, name: base?.name ?? "Endless ensemble", settings: { ...settings, mode: "endless" }, seeds, locks, plan, tracks,
      master: base?.master ?? defaultMaster(this.profile),
    };
    this.writer = new Writer({ plan, tracks, profile: this.profile, settings, seeds, locks, previous: null, pieceEnd: Infinity });
  }

  get plan(): Plan {
    return this.composition.plan;
  }

  get bb(): Beats {
    return barBeats(this.plan.meter);
  }

  status(): EndlessStatus {
    return { sections: this.plan.sections.length, chapters: this.chapter, bars: this.plan.bars, key: this.centre.key, scale: this.centre.scale, lastChapter: this.lastKind };
  }

  /** Write chapters until at least `untilBar` bars exist. Returns true if anything was written. */
  ensure(untilBar: number): boolean {
    let wrote = false;
    let guard = 0;
    while (this.plan.bars < untilBar && guard++ < 64) {
      this.nextChapter();
      wrote = true;
    }
    return wrote;
  }

  private themeOptions(): ThemeOptions {
    return { grammar: this.profile.motif, meter: this.plan.meter, scale: this.centre.scale, complexity: this.settings.controls.rhythmicComplexity };
  }

  private themeFor(kind: Chapter, r: Rng): string {
    const themes = this.plan.themes;
    const opts = this.themeOptions();
    if (!themes.A) {
      themes.A = inventTheme("A", r.fork("A"), opts);
      this.themeOrder.push("A");
      return "A";
    }
    if (kind === "return" || kind === "exposition" || kind === "climax") return kind === "climax" && this.themeOrder.length > 1 && r.chance(0.3) ? r.pick(this.themeOrder) : "A";
    if (kind === "new" && !this.locks.melody) {
      const id = String.fromCharCode(65 + this.themeOrder.length) + (this.themeOrder.length >= 26 ? this.themeOrder.length : "");
      const from = themes[r.pick(this.themeOrder)];
      themes[id] = this.themeOrder.length === 1 ? contrastTheme(id, from, r.fork(id), opts) : deriveTheme(id, from, r.fork(id), opts);
      this.themeOrder.push(id);
      this.sinceNew = 0;
      return id;
    }
    // contrast and development draw on themes already heard (memory resurfacing)
    const pool = this.themeOrder.length > 1 ? this.themeOrder.slice(1) : this.themeOrder;
    return r.pick(pool);
  }

  private chooseKind(r: Rng, t: number): Chapter {
    if (this.chapter === 0) return "exposition";
    if (this.locks.arrangement && this.lastKind) return this.lastKind;
    const level = this.wave(t);
    const evo = this.settings.controls.evolution;
    const w: Record<Chapter, number> = {
      exposition: 0.2,
      contrast: 1.2,
      development: 0.8 + evo,
      interlude: level < 0.4 ? 1.6 : 0.4,
      return: 0.5 + this.sinceReturn * 0.35,
      climax: level > 0.7 ? 1.4 : 0.1,
      new: this.locks.melody ? 0 : 0.15 + evo * 0.6 + this.sinceNew * 0.08,
    };
    if (this.lastKind === "climax") {
      w.climax = 0;
      w.interlude += 1.5;
    }
    if (this.lastKind) w[this.lastKind] *= 0.35;
    const items = Object.keys(w) as Chapter[];
    return r.weighted(items, items.map((k) => w[k]));
  }

  /** Long-range intensity (0..1) at section count t: two slow incommensurate waves. */
  private wave(t: number): number {
    const phase = (hash32(`${this.seeds.arrangement}:wave`) % 1000) / 1000;
    const v = 0.5 + 0.28 * Math.sin((2 * Math.PI * t) / 11 + phase * 6.28) + 0.14 * Math.sin((2 * Math.PI * t) / 4.3 + phase * 2.1);
    return Math.max(0.12, Math.min(0.95, v));
  }

  private modulate(r: Rng): void {
    if (this.locks.harmony || this.chapter === 0) return;
    const evo = this.settings.controls.evolution;
    if (this.awayFor >= 2 && r.chance(0.6)) {
      this.centre = { ...this.home };
      this.awayFor = 0;
      return;
    }
    if (!r.chance(evo * 0.35)) {
      if (this.centre.key !== this.home.key || this.centre.scale !== this.home.scale) this.awayFor++;
      return;
    }
    const rel = RELATIVE[this.centre.scale];
    const orffOnly = this.profile.id === "traditional" && this.settings.realism === "orff";
    const opts: { key: number; scale: ScaleId }[] = [];
    if (rel) opts.push({ key: (this.centre.key + rel[0]) % 12, scale: rel[1] });
    if (!orffOnly) opts.push({ key: (this.centre.key + 7) % 12, scale: this.centre.scale }, { key: (this.centre.key + 5) % 12, scale: this.centre.scale });
    if (!opts.length) return;
    this.centre = r.pick(opts);
    this.awayFor = 1;
  }

  private nextChapter(): void {
    const r = rng(hash32(`${this.seeds.arrangement}:chapter:${this.chapter}`));
    const P = this.profile.phraseBars;
    const bb = this.bb;
    this.modulate(r.fork("key"));
    let kind = this.chooseKind(r.fork("kind"), this.plan.sections.length);
    // nothing to contrast with yet: introduce new material instead
    if ((kind === "contrast" || kind === "development") && this.themeOrder.length < 2 && this.chapter >= 2 && !this.locks.melody) kind = "new";
    const level = this.wave(this.plan.sections.length);
    const shapes: Record<Chapter, SectionFn[]> = {
      exposition: ["intro", "theme", "variation"],
      contrast: ["contrast", "variation"],
      development: ["development", "development"],
      interlude: ["interlude"],
      return: ["variation", "resolution"],
      climax: ["climax"],
      new: ["theme", "variation"],
    };
    const shape = this.locks.arrangement && this.lastShape.length ? this.lastShape : shapes[kind];
    const theme = this.themeFor(kind, r.fork("theme"));
    const [dLo, dHi] = this.profile.dynamics;
    const newSections: Section[] = [];
    shape.forEach((fn, k) => {
      const index = this.plan.sections.length + newSections.length;
      const phrases = fn === "intro" || fn === "interlude" ? 1 + r.int(0, 1) : fn === "climax" ? 3 + r.int(0, 1) : 2 + 2 * r.int(0, 1);
      const bars = phrases * P;
      const startBar = this.plan.bars + newSections.reduce((s, x) => s + x.bars, 0);
      const t = index;
      const local = Math.max(0, Math.min(1, this.wave(t) + (fn === "climax" ? 0.15 : fn === "interlude" || fn === "intro" ? -0.25 : 0)));
      const sectionTheme = fn === "intro" || fn === "interlude" ? null : theme;
      const variant = sectionTheme && this.firstStatement.has(sectionTheme) ? (fn === "development" ? 2 : this.locks.melody ? 0 : 1) : 0;
      const langR = rng(hash32(`${this.seeds.harmony}:lang:${index}`));
      const first = sectionTheme ? this.firstStatement.get(sectionTheme) : undefined;
      let language: HarmonyLanguage = first && fn !== "development" && fn !== "climax" ? first.language : langR.weighted(entries(languageWeights(this.profile, fn === "interlude" ? "intro" : fn)).items, entries(languageWeights(this.profile, fn === "interlude" ? "intro" : fn)).weights);
      if (this.locks.harmony && this.plan.sections.length) language = this.plan.sections[this.plan.sections.length - 1].language;
      const sec: Section = {
        index, label: sectionTheme ? sectionTheme + (variant ? "′" : "") : fn === "interlude" ? "Interlude" : "Intro", name: chapterName(kind, fn), fn: fn === "interlude" ? "intro" : fn,
        startBar, bars, intensity: dLo + (dHi - dLo) * local, theme: sectionTheme, variant, language, key: this.centre.key, scale: this.centre.scale,
        phrases: [], carrier: null, imitation: { kind: "none", followers: [], offsetBars: 1, interval: 0 }, parts: {},
      };
      sec.phrases = phrasePlan(sec, null, P, false);
      newSections.push(sec);
      void k;
    });
    this.lastShape = shape;
    this.lastKind = kind;
    this.sinceReturn = kind === "return" || kind === "exposition" ? 0 : this.sinceReturn + 1;
    this.sinceNew++;
    void level;

    this.orch.frozen = this.locks.instruments && this.plan.sections.length > 0;
    orchestrate({ sections: newSections, tracks: this.composition.tracks, profile: this.profile, controls: this.settings.controls, form: "through", realism: this.settings.realism, themeBars: themeBars(this.profile.motif, this.plan.meter), phraseBars: P }, rng(hash32(`${this.seeds.arrangement}:orch:${this.chapter}`)), this.orch);

    // harmony: a refrain returns with its own chords; under a harmony lock the last section cycles
    for (const sec of newSections) {
      const first = sec.theme ? this.firstStatement.get(sec.theme) : undefined;
      const last = this.plan.sections[this.plan.sections.length - 1];
      let slots: ChordSlot[];
      if (this.locks.harmony && last) slots = reuseHarmony(this.plan.harmony, { ...last, phrases: last.phrases }, sec, bb);
      else if (first && sec.variant <= 1 && first.scale === sec.scale && first.language === sec.language && this.firstHarmony.has(sec.theme!)) {
        // a refrain in a new key returns with its own harmony, transposed
        const src = this.firstHarmony.get(sec.theme!)!;
        slots = reuseHarmony(first.key === sec.key ? src : retargetSlots(src, { key: first.key, scale: first.scale }, { key: sec.key, scale: sec.scale }), first, sec, bb);
      } else slots = sectionHarmony(sec, { meter: this.plan.meter, behavior: this.plan.behavior, profile: this.profile, controls: this.settings.controls }, this.prevSlot, rng(hash32(`${this.seeds.harmony}:harmony:${sec.index}`)));
      this.plan.harmony.push(...slots);
      this.prevSlot = slots[slots.length - 1] ?? this.prevSlot;
      this.plan.sections.push(sec);
      if (sec.theme && !first) {
        this.firstStatement.set(sec.theme, sec);
        this.firstHarmony.set(sec.theme, slots.map((s) => ({ ...s })));
      }
    }
    this.plan.bars += newSections.reduce((s, x) => s + x.bars, 0);

    // write and polish the chapter
    const parts = newSections.flatMap((sec) => this.writer.writeSection(sec));
    // a locked (held) track repeats its last section through the whole chapter
    for (const t of this.composition.tracks.filter((x) => x.locked)) {
      const held = this.heldDrafts(t, newSections[0].startBar * bb, newSections.reduce((s, x) => s + x.bars, 0) * bb);
      const mine = parts.filter((p) => p.trackId === t.id);
      mine.forEach((p, i) => (p.drafts = i === 0 ? held : []));
      if (!mine.length && held.length) parts.push({ trackId: t.id, sectionIndex: newSections[0].index, technique: "held", priority: -1, locked: true, drafts: held });
    }
    const stats = consonancePass(parts, this.composition.tracks, this.plan, (i) => this.writer.ctxFor(this.plan.sections.find((s) => s.index === i)!), this.settings.controls, this.settings.realism, this.tail);
    for (const k of Object.keys(stats) as (keyof PolishStats)[]) this.stats[k] += stats[k];
    const finished = finishParts(parts, this.composition.tracks, this.plan, this.settings, this.seeds, this.profile, this.stats);
    const chapterStart = newSections[0].startBar * bb;
    const chapterEnd = this.plan.bars * bb;
    this.tail = [];
    for (const t of this.composition.tracks) {
      const add = (finished.get(t.id) ?? []).filter((n) => n.start >= chapterStart - 1e-6);
      const maxId = t.notes.reduce((m, n) => Math.max(m, n.id), 0);
      add.forEach((n, i) => (n.id = maxId + i + 1));
      t.notes.push(...add);
      // what is still ringing at the chapter's end is context for the next chapter's consonance pass
      const damped = dampsAtNoteEnd(t.damp, t.role, t.instrumentId);
      const ring = (ringSeconds(t.engine) * this.plan.bpm) / 60;
      for (const n of add) {
        const end = soundingEnd(n, damped, ring);
        if (end > chapterEnd - 1e-6) this.tail.push({ start: n.start, end, dur: n.dur, midi: n.midi, track: t.id, damped, ring });
      }
    }
    this.chapter++;
  }

  private firstHarmony = new Map<string, ChordSlot[]>();

  private heldDrafts(t: Track, from: Beats, length: Beats) {
    const bb = this.bb;
    const last = [...this.plan.sections].reverse().find((s) => s.startBar * bb < from - 1e-6);
    if (!last) return [];
    const s0 = last.startBar * bb;
    const span = last.bars * bb;
    const src = t.notes.filter((n) => n.start >= s0 - 1e-6 && n.start < s0 + span - 1e-6);
    const out = [];
    for (let off = 0; off < length - 1e-6; off += span) for (const n of src) if (n.start - s0 + off < length - 1e-6) out.push({ start: from + off + (n.start - s0), dur: n.dur, midi: n.midi, vel: n.vel, motif: n.motif, tag: n.tag });
    return out;
  }

  /** Forget material that ended before `beforeBar` (notes, sections and harmony). */
  trim(beforeBar: number): void {
    const cut = beforeBar * this.bb;
    for (const t of this.composition.tracks) t.notes = t.notes.filter((n) => n.start + n.dur >= cut);
    const keepSec = this.plan.sections.filter((s) => (s.startBar + s.bars) * this.bb > cut || this.firstStatementSet().has(s));
    this.plan.sections.splice(0, this.plan.sections.length, ...keepSec);
    const keepH = this.plan.harmony.filter((s) => s.start + s.dur > cut);
    this.plan.harmony.splice(0, this.plan.harmony.length, ...keepH);
  }

  private firstStatementSet(): Set<Section> {
    return new Set(this.firstStatement.values());
  }

  /** An editable arrangement of bars [fromBar, toBar) of the performance. */
  capture(fromBar: number, toBar: number): Composition {
    const bb = this.bb;
    const a = fromBar * bb;
    const b = toBar * bb;
    const plan = this.plan;
    const sections = plan.sections
      .filter((s) => s.startBar < toBar && s.startBar + s.bars > fromBar)
      .map((s, i) => {
        const startBar = Math.max(s.startBar, fromBar) - fromBar;
        const endBar = Math.min(s.startBar + s.bars, toBar) - fromBar;
        return { ...structuredClone(s), index: i, startBar, bars: endBar - startBar, phrases: s.phrases.filter((p) => p.startBar < toBar && p.startBar + p.bars > fromBar).map((p) => ({ ...p, startBar: Math.max(p.startBar, fromBar) - fromBar })) };
      });
    const harmony = plan.harmony.filter((s) => s.start < b && s.start + s.dur > a).map((s) => ({ ...s, start: Math.max(s.start, a) - a, dur: Math.min(s.start + s.dur, b) - Math.max(s.start, a) }));
    const tracks = this.composition.tracks.map((t) => ({
      ...structuredClone({ ...t, notes: [] as NoteEvent[] }),
      notes: t.notes.filter((n) => n.start >= a - 1e-6 && n.start < b - 1e-6).map((n, i) => ({ ...n, id: i + 1, start: n.start - a, dur: Math.min(n.dur, b - n.start) })),
    }));
    return {
      ...structuredClone({ ...this.composition, tracks: [] }),
      settings: { ...this.composition.settings, mode: "arrangement", lengthMode: "bars", bars: toBar - fromBar },
      plan: { ...structuredClone({ ...plan, sections: [], harmony: [] }), bars: toBar - fromBar, sections, harmony, form: "through" },
      tracks,
      name: `${this.composition.name} (captured)`,
    };
  }
}

function chapterName(kind: Chapter, fn: SectionFn): string {
  const names: Record<Chapter, string> = { exposition: "Exposition", contrast: "Contrast", development: "Development", interlude: "Interlude", return: "Return", climax: "Climax", new: "New material" };
  return fn === "intro" ? "Introduction" : `${names[kind]}${fn === "variation" ? " (varied)" : fn === "resolution" ? " (settling)" : ""}`;
}
