// POLISH. After every part is written, the ensemble is checked as a whole:
//
//  1. CONSONANCE. Parts are visited in priority order (melody, its imitations, bass, bordun,
//     counter-melody, harmony, ostinato … texture last). Each note is compared with every note of a
//     higher-priority part sounding at its onset — including bars still ringing from earlier
//     strikes, weighted by how far they have decayed. A note that rubs (semitone, tritone) beyond
//     what the harmonic behaviour allows at that metric position moves to the nearest pitch that
//     fits (a chord tone if it was one), or — for colour parts — is left out. Expressive and
//     Experimental behaviour keep a budget of intentional dissonances at points of harmonic tension.
//  2. CONSTRAINTS. Range (playable Orff/concert range, or the extended electronic range), the
//     number of mallets one player holds, how fast one player can strike, and no bar struck while
//     the same bar is still held.
//  3. DYNAMICS. Section intensity terraces, crescendo into a louder section, diminuendo through an
//     ending, a gentle arch over each phrase, ambient layers fading in.
//  4. HUMANISATION. Seeded timing and velocity deviation, resolved now so that playback, the editor
//     and every export contain identical notes. Notes struck together share their deviation.

import { slotAt, type MusicalContext } from "../theory/context";
import { beatStrength, barBeats } from "../theory/meter";
import { hash32, rng } from "../theory/rng";
import { inScale } from "../theory/scales";
import type { Beats } from "../theory/types";
import { dampsAtNoteEnd, ensembleInfo, instrumentRange, ringSeconds } from "./instruments";
import { clash } from "./parts/imitation";
import type { ComposeControls, Draft, NoteEvent, Plan, Section, Track } from "./types";

export interface WrittenPart {
  trackId: string;
  sectionIndex: number;
  technique: string;
  priority: number;
  locked: boolean;
  drafts: Draft[];
}

export interface PolishStats {
  checked: number;
  moved: number;
  dropped: number;
  kept: number;
  intentional: number;
  rangeFolded: number;
  malletTrimmed: number;
  speedTrimmed: number;
}

const PRIORITY: Record<string, number> = {
  melody: 0, imitate: 1, bass: 2, bordun: 3, counter: 4, harmony: 5, ostinato: 6, parallel: 7, heterophony: 7,
  arpeggio: 8, experimental: 9, punctuation: 10, texture: 11,
};

export function priorityOf(technique: string, locked: boolean): number {
  if (locked) return -1;
  return PRIORITY[technique.split(":")[0]] ?? 8;
}

const DROPPABLE = new Set(["texture", "punctuation", "arpeggio", "experimental", "ostinato", "harmony", "parallel", "heterophony"]);
const STRUCTURAL = new Set(["bass", "bordun", "harmony", "arpeggio"]);

export interface Accepted {
  start: Beats;
  end: Beats;
  dur: Beats;
  midi: number;
  track: string;
  damped: boolean;
  ring: Beats;
}

/** Sounding end of a note: its written end when damped, else its ring time. */
export function soundingEnd(n: { start: Beats; dur: Beats }, damped: boolean, ringBeats: Beats): Beats {
  return n.start + (damped ? n.dur : Math.max(n.dur, ringBeats));
}

export function consonancePass(parts: WrittenPart[], tracks: Track[], plan: Plan, ctxFor: (sectionIndex: number) => MusicalContext, controls: ComposeControls, realism: "orff" | "extended", context: Accepted[] = []): PolishStats {
  const stats: PolishStats = { checked: 0, moved: 0, dropped: 0, kept: 0, intentional: 0, rangeFolded: 0, malletTrimmed: 0, speedTrimmed: 0 };
  const trackById = new Map(tracks.map((t) => [t.id, t]));
  const bucket = new Map<number, Accepted[]>();
  const add = (a: Accepted) => {
    for (let b = Math.floor(a.start); b <= Math.floor(a.end); b++) {
      const list = bucket.get(b) ?? [];
      list.push(a);
      bucket.set(b, list);
    }
  };
  context.forEach(add);
  const ringBeatsOf = (t: Track) => (ringSeconds(t.engine) * plan.bpm) / 60;
  const budget = new Map<number, number>();
  const bb = barBeats(plan.meter);
  const ordered = [...parts].sort((a, b) => a.priority - b.priority || a.sectionIndex - b.sectionIndex);
  for (const p of ordered) {
    const track = trackById.get(p.trackId);
    if (!track) continue;
    const ctx = ctxFor(p.sectionIndex);
    const damped = dampsAtNoteEnd(track.damp, track.role, track.instrumentId);
    const ring = ringBeatsOf(track);
    const [lo, hi] = instrumentRange(track.instrumentId, realism);
    const role = p.technique.split(":")[0];
    const sec = plan.sections.find((x) => x.index === p.sectionIndex);
    if (!budget.has(p.sectionIndex)) budget.set(p.sectionIndex, Math.round((sec?.bars ?? 8) * controls.dissonance * 0.5));
    const kept: Draft[] = [];
    for (const d of p.drafts) {
      stats.checked++;
      const sev = (m: number) => severity(bucket, { start: d.start, end: soundingEnd(d, damped, ring), dur: d.dur, midi: m, damped, ring }, p.trackId, plan.meter);
      const w = beatStrength(plan.meter, ((d.start % bb) + bb) % bb);
      const limit = threshold(ctx.behavior, controls.dissonance, w);
      let s = p.locked ? 0 : sev(d.midi);
      if (s > limit) {
        const slot = slotAt(ctx, d.start);
        const tension = slot.tension ?? 0;
        if (ctx.behavior !== "strict" && tension >= 0.6 && (budget.get(p.sectionIndex) ?? 0) > 0 && s < 1.01) {
          budget.set(p.sectionIndex, (budget.get(p.sectionIndex) ?? 0) - 1);
          stats.intentional++;
        } else {
          const wasChordTone = slot.chord.pcs.includes(((d.midi % 12) + 12) % 12);
          const needChord = wasChordTone || STRUCTURAL.has(role) || w >= 0.75;
          const fits = (chordOnly: boolean) => (m: number) => {
            const pc = ((m % 12) + 12) % 12;
            if (ctx.behavior !== "experimental" && !inScale(m, ctx.key, ctx.scale, ctx.custom)) return false;
            if (chordOnly && !slot.chord.pcs.includes(pc)) return false;
            return sev(m) <= limit;
          };
          // a chord tone if it was one; failing that, any consonant scale tone (melodic parts)
          let fix = bestFix(d.midi, lo, hi, fits(needChord), role === "texture" || role === "arpeggio");
          if (fix === null && needChord && !STRUCTURAL.has(role)) fix = bestFix(d.midi, lo, hi, fits(false), false);
          if (fix !== null) {
            d.midi = fix;
            stats.moved++;
            s = 0;
          } else if (DROPPABLE.has(role) && !(d.tag === "cadence" || d.tag === "final" || d.fixed)) {
            stats.dropped++;
            continue;
          } else stats.kept++;
        }
      }
      kept.push(d);
      add({ start: d.start, end: soundingEnd(d, damped, ring), dur: d.dur, midi: d.midi, track: p.trackId, damped, ring });
    }
    p.drafts = kept;
  }
  return stats;
}

function threshold(behavior: MusicalContext["behavior"], dissonance: number, w: number): number {
  const strong = w >= 0.5;
  if (behavior === "strict") return strong ? 0.3 : 0.5;
  if (behavior === "expressive") return (strong ? 0.42 : 0.58) + dissonance * 0.1;
  return (strong ? 0.36 : 0.55) + dissonance * 0.45;
}

export interface Sounding {
  start: Beats;
  end: Beats;
  dur: Beats;
  midi: number;
  damped: boolean;
  ring: Beats;
}

/** How much two sounding notes of different parts rub, 0..1. The later onset is heard against the
 *  earlier note as it is at that moment: a ringing bar has decayed, a damped one is either fully
 *  there or gone. Overlaps under ~40 ms (a damped note meeting the next strike) do not count, and a
 *  short passing note on a weak position is a milder rub than a held or accented one. */
export function pairSeverity(a: Sounding, b: Sounding, meter: Plan["meter"]): number {
  const [early, late] = a.start <= b.start ? [a, b] : [b, a];
  const overlap = Math.min(early.end, late.end) - late.start;
  if (overlap < 0.08) return 0;
  const c = clash(early.midi, late.midi);
  if (!c) return 0;
  const elapsed = late.start - early.start;
  const decay = early.damped || elapsed <= 0.02 ? 1 : Math.max(0.2, Math.exp(-elapsed / Math.max(0.25, early.ring)));
  const bb = barBeats(meter);
  const w = beatStrength(meter, ((late.start % bb) + bb) % bb);
  const passing = Math.min(late.dur, overlap) < 0.5 && w < 0.5 ? 0.6 : 1;
  return c * decay * passing;
}

function severity(bucket: Map<number, Accepted[]>, d: Sounding, self: string, meter: Plan["meter"]): number {
  let worst = 0;
  const seen = new Set<Accepted>();
  for (let b = Math.floor(d.start); b <= Math.floor(d.end - 1e-6); b++) {
    for (const a of bucket.get(b) ?? []) {
      if (a.track === self || seen.has(a)) continue;
      seen.add(a);
      if (a.end <= d.start + 1e-6 || a.start >= d.end - 1e-6) continue;
      worst = Math.max(worst, pairSeverity(a, d, meter));
      if (worst >= 1) return worst;
    }
  }
  return worst;
}

function bestFix(midi: number, lo: number, hi: number, ok: (m: number) => boolean, octave: boolean): number | null {
  const deltas = [1, -1, 2, -2, 3, -3, 4, -4, 5, -5, ...(octave ? [12, -12] : [])];
  for (const d of deltas) {
    const m = midi + d;
    if (m < lo || m > hi) continue;
    if (ok(m)) return m;
  }
  return null;
}

// ------------------------------------------------------------------ constraints

export function applyConstraints(track: Track, drafts: Draft[], plan: Plan, realism: "orff" | "extended", stats: PolishStats): Draft[] {
  const [lo, hi] = instrumentRange(track.instrumentId, realism);
  const info = ensembleInfo(track.instrumentId);
  let out = drafts.map((d) => {
    let m = d.midi;
    if (m < lo || m > hi) stats.rangeFolded++;
    while (m > hi) m -= 12;
    while (m < lo) m += 12;
    return m === d.midi ? d : { ...d, midi: m };
  });
  out.sort((a, b) => a.start - b.start || b.midi - a.midi);
  // mallets: notes struck together beyond what one player holds — keep the outer voices
  const mallets = realism === "orff" ? info.mallets : 8;
  const grouped: Draft[][] = [];
  for (const d of out) {
    const g = grouped[grouped.length - 1];
    if (g && Math.abs(g[0].start - d.start) < 0.02) {
      if (!g.some((x) => x.midi === d.midi)) g.push(d);
    } else grouped.push([d]);
  }
  out = grouped.flatMap((g) => {
    if (g.length <= mallets) return g;
    stats.malletTrimmed += g.length - mallets;
    const sorted = [...g].sort((a, b) => b.midi - a.midi);
    const keep = [sorted[0], sorted[sorted.length - 1], ...sorted.slice(1, -1)].slice(0, mallets);
    return keep;
  });
  // striking speed: one player cannot strike faster than its minimum gap
  if (realism === "orff") {
    const gap = (info.minGap * plan.bpm) / 60;
    const res: Draft[] = [];
    let lastStart = -Infinity;
    for (const d of out) {
      if (d.start - lastStart > 0.02 && d.start - lastStart < gap - 1e-6 && !(d.tag === "cadence" || d.tag === "final" || d.fixed)) {
        stats.speedTrimmed++;
        continue;
      }
      if (d.start - lastStart > 0.02) lastStart = d.start;
      res.push(d);
    }
    out = res;
  }
  // a bar cannot be struck while the same bar is still held: shorten the earlier note
  const lastOf = new Map<number, Draft>();
  for (const d of out) {
    const prev = lastOf.get(d.midi);
    if (prev && prev.start + prev.dur > d.start + 1e-6) prev.dur = Math.max(0.05, d.start - prev.start);
    lastOf.set(d.midi, d);
  }
  return out;
}

// ------------------------------------------------------------------ dynamics and humanisation

const ROLE_LEVEL: Record<string, number> = { melody: 1, secondary: 0.92, counter: 0.88, bass: 0.95, bordun: 0.88, ostinato: 0.86, harmony: 0.8, arpeggio: 0.82, punctuation: 0.92, texture: 0.85, experimental: 0.88 };

export function sectionAtBeat(plan: Plan, beat: Beats): Section {
  const bb = barBeats(plan.meter);
  let s = plan.sections[0];
  for (const x of plan.sections) if (x.startBar * bb <= beat + 1e-6) s = x;
  return s;
}

/** Loudness level 0..1 at a beat: the section's terrace, ramped into a louder next section over
 *  its last phrase, and tapering through an ending. */
export function dynamicLevel(plan: Plan, beat: Beats): number {
  const bb = barBeats(plan.meter);
  const sec = sectionAtBeat(plan, beat);
  const i = plan.sections.indexOf(sec);
  const next = plan.sections[i + 1];
  const start = sec.startBar * bb;
  const end = (sec.startBar + sec.bars) * bb;
  let level = sec.intensity;
  const lastPhrase = sec.phrases[sec.phrases.length - 1];
  const lpStart = lastPhrase ? lastPhrase.startBar * bb : end;
  if (next && next.intensity - sec.intensity > 0.15 && beat >= lpStart) {
    const f = (beat - lpStart) / Math.max(1e-6, end - lpStart);
    level += (next.intensity - sec.intensity) * f * 0.8;
  }
  if (sec.fn === "ending") level *= 1 - 0.35 * ((beat - start) / Math.max(1e-6, end - start));
  return Math.max(0, Math.min(1, level));
}

export function finishTrack(track: Track, drafts: Draft[], plan: Plan, controls: ComposeControls, humanSeed: number, profileId: string, enterBeats: Map<number, Beats>): NoteEvent[] {
  const bb = barBeats(plan.meter);
  const r = rng(hash32(`${humanSeed}:human:${track.id}:${track.seed}`));
  const h = controls.humanize;
  const secPerBeat = 60 / plan.bpm;
  const shared = new Map<number, { dt: number; dv: number }>();
  const sorted = [...drafts].sort((a, b) => a.start - b.start || a.midi - b.midi);
  const notes: NoteEvent[] = sorted.map((d) => {
    if (d.fixed) return { id: 0, start: d.start, dur: d.dur, midi: d.midi, vel: d.vel, ...(d.motif ? { motif: d.motif } : {}), ...(d.tag ? { tag: d.tag } : {}) };
    const key = Math.round(d.start * 960);
    let dev = shared.get(key);
    if (!dev) {
      dev = { dt: (r.gauss() * h * 0.011) / secPerBeat, dv: r.gauss() * h * 0.06 };
      shared.set(key, dev);
    }
    const sec = sectionAtBeat(plan, d.start);
    const ph = sec.phrases.find((p) => p.startBar * bb <= d.start + 1e-6 && (p.startBar + p.bars) * bb > d.start + 1e-6) ?? sec.phrases[0];
    const f = ph ? (d.start - ph.startBar * bb) / Math.max(1e-6, ph.bars * bb) : 0.5;
    const arch = 0.93 + 0.1 * Math.sin(Math.PI * Math.min(1, f / 0.8));
    const level = 0.5 + 0.5 * dynamicLevel(plan, d.start);
    let fade = 1;
    const entered = enterBeats.get(sec.index);
    if (profileId === "ambient" && entered !== undefined && d.start - entered < 4 * bb) fade = 0.6 + 0.4 * ((d.start - entered) / (4 * bb));
    const vel = Math.max(0.06, Math.min(1, d.vel * (ROLE_LEVEL[track.role] ?? 0.85) * level * arch * fade * (1 + dev.dv)));
    const start = Math.max(0, d.start + (d.tag === "final" ? 0 : dev.dt));
    return { id: 0, start: round(start), dur: round(Math.max(0.05, d.dur)), midi: d.midi, vel: round(vel), ...(d.motif ? { motif: d.motif } : {}), ...(d.tag ? { tag: d.tag } : {}) };
  });
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  notes.forEach((n, i) => (n.id = i + 1));
  return notes;
}

const round = (x: number) => Math.round(x * 1e5) / 1e5;
