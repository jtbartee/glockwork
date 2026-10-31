// ANALYSIS. Measurements of a composition, used by the tests, the listening report and the UI.
// None of these numbers proves a piece sounds good; they catch the ways a generator can fail
// (out-of-scale notes, semitone rubs, everyone playing all the time, themes that never return,
// cadences that do not cadence) and they make "meaningful variation" a number instead of a claim.

import { musicalContext, slotAt, type MusicalContext } from "../theory/context";
import { barBeats, beatStrength } from "../theory/meter";
import { inScale } from "../theory/scales";
import type { Beats } from "../theory/types";
import { dampsAtNoteEnd, ringSeconds } from "./instruments";
import { cadenceTargets } from "./parts/melody";
import { pairSeverity, sectionAtBeat, soundingEnd } from "./polish";
import type { Composition, NoteEvent, Section, Track } from "./types";

const mod12 = (x: number) => ((x % 12) + 12) % 12;

export interface Analysis {
  notes: number;
  /** share of strong-beat notes (structural parts) that are chord tones */
  chordToneStrong: number;
  /** notes outside their section's scale */
  outOfScale: number;
  /** onsets that rub a semitone against something sounding, per 100 onsets */
  clashesPer100: number;
  /** onsets forming a tritone with something sounding, per 100 onsets (characteristic of some modes) */
  tritonesPer100: number;
  /** mean / max number of parts playing in a bar, and share of bars where every part plays */
  meanActive: number;
  maxActive: number;
  tuttiBars: number;
  /** per track: share of bars with no onset */
  silence: Record<string, number>;
  /** contour similarity of each theme's returns to its first statement, and between different themes */
  returnSimilarity: number;
  contrastSimilarity: number;
  /** share of phrase endings that land on their cadence's target pitch class */
  cadenceAccuracy: number;
  /** most voices sounding at once (ringing bars included) */
  peakVoices: number;
  /** distinct sets of active parts across sections */
  distinctTextures: number;
  /** notes per bar, coefficient of variation across sections */
  densityVariation: number;
}

export function contextFor(c: Composition, sec: Section): MusicalContext {
  return musicalContext({ key: sec.key, scale: sec.scale, custom: c.plan.custom, meter: c.plan.meter, behavior: c.plan.behavior, slots: c.plan.harmony });
}

const STRUCTURAL = new Set(["bass", "bordun", "harmony", "arpeggio", "melody", "counter", "secondary", "ostinato"]);

function ringBeats(c: Composition, t: Track): Beats {
  return (ringSeconds(t.engine) * c.plan.bpm) / 60;
}

/** Melodic similarity of two lines: longest common subsequence of (interval, rhythm) tokens —
 *  the interval in semitones folded within a tritone (so an octave displacement does not hide the
 *  shape) and the gap to the next onset in sixteenths — relative to the longer line. */
export function contourSimilarity(a: NoteEvent[] | number[], b: NoteEvent[] | number[]): number {
  const fold = (d: number) => ((((d + 6) % 12) + 12) % 12) - 6;
  const tok = (xs: NoteEvent[] | number[]) => {
    const notes = (typeof xs[0] === "number" ? (xs as number[]).map((m, i) => ({ midi: m, start: i })) : (xs as NoteEvent[])) as { midi: number; start: number }[];
    return notes.slice(1).map((n, i) => `${fold(n.midi - notes[i].midi)}:${Math.round((n.start - notes[i].start) * 4)}`);
  };
  const x = tok(a);
  const y = tok(b);
  if (!x.length || !y.length) return 0;
  const dp = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) dp[i][j] = x[i - 1] === y[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[x.length][y.length] / Math.max(x.length, y.length);
}

/** Rhythm similarity: share of onset positions (within the bar grid) two lines share. */
export function rhythmSimilarity(a: NoteEvent[], b: NoteEvent[], bb: Beats, offA: Beats, offB: Beats, span: Beats): number {
  const pa = new Set(a.filter((n) => n.start - offA < span).map((n) => Math.round(((n.start - offA) % span) * 4)));
  const pb = new Set(b.filter((n) => n.start - offB < span).map((n) => Math.round(((n.start - offB) % span) * 4)));
  if (!pa.size || !pb.size) return 0;
  let common = 0;
  for (const x of pa) if (pb.has(x)) common++;
  void bb;
  return common / Math.max(pa.size, pb.size);
}

/** The principal line of a section: carrier notes plus imitation followers' share (call, hocket). */
export function principalLine(c: Composition, sec: Section): NoteEvent[] {
  const bb = barBeats(c.plan.meter);
  const s = sec.startBar * bb;
  const e = (sec.startBar + sec.bars) * bb;
  const ids = [sec.carrier, ...(sec.imitation.kind === "call" || sec.imitation.kind === "hocket" ? sec.imitation.followers : [])].filter((x): x is string => !!x);
  return ids.flatMap((id) => (c.tracks.find((t) => t.id === id)?.notes ?? []).filter((n) => n.start >= s - 1e-6 && n.start < e - 1e-6)).sort((a, b) => a.start - b.start);
}

export function analyse(c: Composition): Analysis {
  const p = c.plan;
  const bb = barBeats(p.meter);
  const ctxs = new Map(p.sections.map((s) => [s.index, contextFor(c, s)]));
  const all = c.tracks.flatMap((t) => t.notes.map((n) => ({ n, t })));
  let strong = 0;
  let strongCt = 0;
  let out = 0;
  for (const { n, t } of all) {
    const sec = sectionAtBeat(p, n.start);
    const ctx = ctxs.get(sec.index)!;
    if (!inScale(n.midi, sec.key, sec.scale, p.custom)) out++;
    // judge metric position on the grid the note was written on (humanisation moves it by ms)
    const q = Math.round(n.start * 24) / 24;
    const w = beatStrength(p.meter, ((q % bb) + bb) % bb);
    if (w >= 0.75 && STRUCTURAL.has(t.role)) {
      strong++;
      if (slotAt(ctx, q).chord.pcs.includes(mod12(n.midi))) strongCt++;
    }
  }

  // clashes and peak voices: sweep onsets against sounding notes of other tracks
  const sounding = c.tracks.flatMap((t) => {
    const damped = dampsAtNoteEnd(t.damp, t.role, t.instrumentId);
    const ring = ringBeats(c, t);
    return t.notes.map((n) => ({ start: n.start, end: soundingEnd(n, damped, ring), dur: n.dur, midi: n.midi, track: t.id, damped, ring }));
  }).sort((a, b) => a.start - b.start);
  let clashes = 0;
  let tritones = 0;
  let onsets = 0;
  let peak = 0;
  const active: typeof sounding = [];
  for (const s of sounding) {
    for (let i = active.length - 1; i >= 0; i--) if (active[i].end <= s.start + 1e-6) active.splice(i, 1);
    onsets++;
    let worst = 0;
    let tri = false;
    for (const a of active) {
      if (a.track === s.track) continue;
      const sev = pairSeverity(a, s, p.meter);
      if (mod12(a.midi - s.midi) === 6 && sev > 0.3) tri = true;
      else worst = Math.max(worst, sev);
    }
    if (worst >= 0.6) clashes++;
    if (tri) tritones++;
    active.push(s);
    peak = Math.max(peak, active.length);
  }

  // activity per bar
  const perBar = new Map<number, Set<string>>();
  const trackBars = new Map<string, Set<number>>();
  for (const { n, t } of all) {
    const b = Math.floor(n.start / bb + 1e-9);
    if (!perBar.has(b)) perBar.set(b, new Set());
    perBar.get(b)!.add(t.id);
    if (!trackBars.has(t.id)) trackBars.set(t.id, new Set());
    trackBars.get(t.id)!.add(b);
  }
  const counts = Array.from({ length: p.bars }, (_, b) => perBar.get(b)?.size ?? 0);
  const N = c.tracks.length;
  const silence: Record<string, number> = {};
  for (const t of c.tracks) silence[t.id] = 1 - (trackBars.get(t.id)?.size ?? 0) / p.bars;

  // motif continuity: each return against its first statement, phrase by phrase at the same
  // positions; first statements of different themes against each other
  const phraseLines = (sec: Section) => {
    const line = principalLine(c, sec);
    return sec.phrases.map((ph) => line.filter((n) => n.start >= ph.startBar * bb - 1e-6 && n.start < (ph.startBar + ph.bars) * bb - 1e-6).map((n) => ({ ...n, start: Math.round(n.start * 4) / 4 })));
  };
  const firstOf = new Map<string, NoteEvent[][]>();
  const returns: number[] = [];
  const contrasts: number[] = [];
  const compare = (a: NoteEvent[][], b: NoteEvent[][]) => {
    const sims: number[] = [];
    for (let k = 0; k < Math.min(a.length, b.length, 4); k++) if (a[k].length >= 3 && b[k].length >= 3) sims.push(contourSimilarity(a[k], b[k]));
    return sims.length ? sims.reduce((x, y) => x + y, 0) / sims.length : null;
  };
  for (const sec of p.sections) {
    if (!sec.theme) continue;
    const lines = phraseLines(sec);
    if (!lines.some((l) => l.length >= 3)) continue;
    const first = firstOf.get(sec.theme);
    if (!first) {
      for (const [, other] of firstOf) {
        const x = compare(lines, other);
        if (x !== null) contrasts.push(x);
      }
      firstOf.set(sec.theme, lines);
    } else if (sec.variant < 2) {
      const x = compare(lines, first);
      if (x !== null) returns.push(x);
    }
  }

  // cadences
  let cad = 0;
  let cadOk = 0;
  for (const sec of p.sections) {
    if (!sec.theme) continue;
    const line = principalLine(c, sec);
    const env = { ctx: ctxs.get(sec.index)!, sec, profileId: p.profile };
    for (const ph of sec.phrases) {
      const s = ph.startBar * bb;
      const e = (ph.startBar + ph.bars) * bb;
      const inPh = line.filter((n) => n.start >= s - 1e-6 && n.start < e - 1e-6);
      const last = inPh[inPh.length - 1];
      if (!last || last.tag !== "cadence") continue;
      cad++;
      if (cadenceTargets(env, Math.round(last.start * 24) / 24, ph.cadence).includes(mod12(last.midi))) cadOk++;
    }
  }

  // textures and density across sections
  const textures = new Set(p.sections.map((s) => Object.entries(s.parts).filter(([, x]) => x.technique).map(([id]) => id).sort().join(",")));
  const dens = p.sections.map((s) => {
    const a = s.startBar * bb;
    const e = (s.startBar + s.bars) * bb;
    return all.filter(({ n }) => n.start >= a && n.start < e).length / Math.max(1, s.bars);
  });
  const mean = dens.reduce((x, y) => x + y, 0) / Math.max(1, dens.length);
  const sd = Math.sqrt(dens.reduce((x, y) => x + (y - mean) ** 2, 0) / Math.max(1, dens.length));

  return {
    notes: all.length,
    chordToneStrong: strong ? strongCt / strong : 1,
    outOfScale: out,
    clashesPer100: onsets ? (100 * clashes) / onsets : 0,
    tritonesPer100: onsets ? (100 * tritones) / onsets : 0,
    meanActive: counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length),
    maxActive: Math.max(0, ...counts),
    tuttiBars: counts.filter((x) => x === N).length / Math.max(1, counts.length),
    silence,
    returnSimilarity: returns.length ? returns.reduce((a, b) => a + b, 0) / returns.length : 1,
    contrastSimilarity: contrasts.length ? contrasts.reduce((a, b) => a + b, 0) / contrasts.length : 0,
    cadenceAccuracy: cad ? cadOk / cad : 1,
    peakVoices: peak,
    distinctTextures: textures.size,
    densityVariation: mean ? sd / mean : 0,
  };
}
