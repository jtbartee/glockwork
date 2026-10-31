// Shared environment and helpers for the part writers.

import { type MusicalContext, slotAt } from "../../theory/context";
import { beatStrength } from "../../theory/meter";
import type { Rng } from "../../theory/rng";
import { degreeToMidi, midiToDegree, scaleIntervals } from "../../theory/scales";
import type { Beats, ChordSlot } from "../../theory/types";
import { ensembleInfo } from "../instruments";
import type { Profile } from "../profiles";
import type { ComposeControls, Draft, PartPlan, Phrase, Plan, Section, ThemeRecord, Track } from "../types";

/** State a track carries from one section to the next (motif identity, voice leading, processes). */
export interface TrackMemory {
  lastPitch?: number;
  voicing?: number[];
  /** ostinato cells by theme letter (a refrain's ostinato returns with it) */
  cells: Record<string, OstinatoCell>;
  /** bordun type by theme letter */
  borduns: Record<string, string>;
  /** minimalist process: how many sections of mutation this cell has been through */
  mutations: number;
  /** polyrhythm cycle (steps) used last */
  cycle?: number;
}

export interface OstinatoCell {
  /** onsets in grid steps within the cell, with lengths in steps and scale-step offsets */
  steps: { at: number; len: number; deg: number }[];
  /** cell length in grid steps */
  length: number;
  grid: Beats;
  /** anchor degree (relative to the tonic at base) the offsets hang from */
  anchor: number;
}

/** What has been written in the current section so far, for parts that react to others. */
export interface SectionShared {
  carrierLine: Draft[];
  carrierFull: Draft[];
  ostinatoRhythms: Set<number>[];
  /** cycle lengths (grid steps) already taken by polyrhythmic parts */
  cycles: number[];
  echoUnits: { from: Beats; to: Beats; cadence: Phrase["cadence"]; phraseEnd: Beats }[];
}

export interface PartEnv {
  plan: Plan;
  sec: Section;
  ctx: MusicalContext;
  bb: Beats;
  start: Beats;
  end: Beats;
  /** last beat of the whole piece (finite) or Infinity (endless) */
  pieceEnd: Beats;
  bpm: number;
  profile: Profile;
  controls: ComposeControls;
  realism: "orff" | "extended";
  track: Track;
  part: PartPlan;
  lo: number;
  hi: number;
  r: Rng;
  /** a stream keyed by theme and position rather than by section: a theme's return re-derives the
   *  same statement instead of re-rolling it */
  themeRng: (theme: string, label: string) => Rng;
  /** rhythm lock: processes (mutation, phasing) hold still */
  hold: boolean;
  memory: TrackMemory;
  shared: SectionShared;
  /** tracks in the lineup, for parts that check who else plays */
  tracks: Track[];
  themes: Record<string, ThemeRecord>;
}

export const mod12 = (x: number) => ((x % 12) + 12) % 12;

export function newMemory(): TrackMemory {
  return { cells: {}, borduns: {}, mutations: 0 };
}

export function phraseAt(sec: Section, bb: Beats, beat: Beats): { phrase: Phrase; index: number } {
  let idx = 0;
  for (let i = 0; i < sec.phrases.length; i++) if (sec.phrases[i].startBar * bb <= beat + 1e-6) idx = i;
  return { phrase: sec.phrases[idx], index: idx };
}

export const phraseStart = (p: Phrase, bb: Beats) => p.startBar * bb;
export const phraseEnd = (p: Phrase, bb: Beats) => (p.startBar + p.bars) * bb;

/** May this part sound at `beat`? (inside its entry/exit window and not in a resting phrase) */
export function playable(env: PartEnv, beat: Beats): boolean {
  const rel = beat - env.start;
  if (rel < env.part.enterBar * env.bb - 1e-6 || rel >= env.part.exitBar * env.bb - 1e-6) return false;
  const mask = env.part.params?.mask;
  if (typeof mask === "string" && mask.length) {
    const { index } = phraseAt(env.sec, env.bb, beat);
    if (mask[index] === "0") return false;
  }
  return beat < env.end - 1e-6;
}

export function strength(env: Pick<PartEnv, "ctx" | "bb">, beat: Beats): number {
  return beatStrength(env.ctx.timeSig, ((beat % env.bb) + env.bb) % env.bb);
}

/** The pitch of pitch class `pc` nearest `near` inside [lo, hi] (octave folded if needed). */
export function place(pc: number, near: number, lo: number, hi: number): number {
  let best = Number.NaN;
  let bd = Infinity;
  for (let m = lo; m <= hi; m++) {
    if (mod12(m) !== mod12(pc)) continue;
    const d = Math.abs(m - near);
    if (d < bd) {
      bd = d;
      best = m;
    }
  }
  if (Number.isNaN(best)) {
    best = near + ((mod12(pc) - mod12(near) + 18) % 12) - 6;
    while (best > hi) best -= 12;
    while (best < lo) best += 12;
  }
  return best;
}

/** Lowest pitch of a pitch class at or above `lo`. */
export const lowest = (pc: number, lo: number) => lo + mod12(pc - lo);

/** Chord slots overlapping [from, to), clipped. */
export function slotsIn(ctx: MusicalContext, from: Beats, to: Beats): { slot: ChordSlot; from: Beats; to: Beats }[] {
  const out: { slot: ChordSlot; from: Beats; to: Beats }[] = [];
  let b = from;
  let guard = 0;
  while (b < to - 1e-6 && guard++ < 4096) {
    const s = slotAt(ctx, b);
    const e = Math.min(to, s.start + s.dur > b + 1e-6 ? s.start + s.dur : to);
    out.push({ slot: s, from: b, to: e });
    if (e <= b + 1e-6) break;
    b = e;
  }
  return out;
}

/** Degree helpers for a part's range: the tonic octave base and its degree bounds. */
export function degreeFrame(env: Pick<PartEnv, "ctx" | "lo" | "hi">) {
  const { key, scale, custom } = env.ctx;
  const base = env.lo - 12 - mod12(env.lo - 12 - key) ; // a tonic at or below the range
  const n = scaleIntervals(scale, custom).length;
  const toMidi = (d: number) => degreeToMidi(d, key, scale, base, custom);
  const toDeg = (m: number) => midiToDegree(m, key, scale, base, custom);
  let loDeg = toDeg(env.lo);
  if (toMidi(loDeg) < env.lo) loDeg++;
  let hiDeg = toDeg(env.hi);
  if (toMidi(hiDeg) > env.hi) hiDeg--;
  return { base, n, toMidi, toDeg, loDeg, hiDeg };
}

export function minGapBeats(env: Pick<PartEnv, "track" | "bpm" | "realism">): Beats {
  if (env.realism !== "orff") return 0.0625;
  return (ensembleInfo(env.track.instrumentId).minGap * env.bpm) / 60;
}

export function draft(start: Beats, dur: Beats, midi: number, vel: number, tag: string, motif?: string): Draft {
  return { start, dur: Math.max(0.0625, dur), midi: Math.round(midi), vel, tag, ...(motif ? { motif } : {}) };
}

// ------------------------------------------------------------------ dynamic-programming line solver

export interface LineProblem {
  count: number;
  candidates: (i: number) => number[];
  local: (i: number, pitch: number) => number;
  transition: (i: number, prev: number, cur: number) => number;
}

/** Viterbi search for the cheapest pitch sequence (used for counter-melodies and bass lines). */
export function solveLine(p: LineProblem): number[] {
  if (!p.count) return [];
  const cands: number[][] = [p.candidates(0)];
  let cost = cands[0].map((m) => p.local(0, m));
  const back: number[][] = [];
  for (let i = 1; i < p.count; i++) {
    const prevC = cands[i - 1];
    const cur = p.candidates(i);
    cands.push(cur);
    const next: number[] = [];
    const bp: number[] = [];
    for (const m of cur) {
      let best = Infinity;
      let arg = 0;
      for (let k = 0; k < prevC.length; k++) {
        const c = cost[k] + p.transition(i, prevC[k], m);
        if (c < best) {
          best = c;
          arg = k;
        }
      }
      next.push(best + p.local(i, m));
      bp.push(arg);
    }
    back.push(bp);
    cost = next;
  }
  let k = cost.indexOf(Math.min(...cost));
  const out = new Array<number>(p.count);
  out[p.count - 1] = cands[p.count - 1][k];
  for (let i = p.count - 1; i >= 1; i--) {
    k = back[i - 1][k];
    out[i - 1] = cands[i - 1][k];
  }
  return out;
}

/** Notes of a draft list sounding at a beat (within a tolerance). */
export function soundingAt(notes: Draft[], beat: Beats, tol = 1e-6): Draft | undefined {
  let found: Draft | undefined;
  for (const n of notes) if (n.start <= beat + tol && n.start + n.dur > beat + tol) found = n;
  return found;
}
