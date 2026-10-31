// THEMES. Elemental melody grows out of speech rhythm: a theme is assembled from rhythm cells —
// ta (♩), ti-ti (♫), tika-tika (𝅘𝅥𝅯×4), ta-a (𝅗𝅥), syn-co-pa (♪♩♪), and in compound time the
// dotted-quarter, quarter-eighth and three-eighth figures — fitted to the meter's own grouping, so
// a 7/8 theme falls 2+2+3 and a 6/8 theme lilts in two. Its contour is written in scale steps
// (APERTURE's motif representation), so it keeps its shape on every chord and in every key.
//
// Traditional Orff contours start from the children's chant — sol–mi, sol–sol–mi, sol–mi–la–sol–mi,
// mi–re–do — the intervals Schulwerk melodies are built from.

import type { Motif, MotifNote } from "../theory/motif";
import { barBeats, groupLengths, METERS } from "../theory/meter";
import type { Rng } from "../theory/rng";
import { isMinorish, scaleIntervals } from "../theory/scales";
import type { MeterId, ScaleId } from "../theory/types";
import { entries, type CellId, type Contour, type MotifGrammar } from "./profiles";
import type { ThemeRecord } from "./types";

interface Cell {
  len: number;
  notes: [number, number][];
  /** 0 = plain, 1 = intricate */
  complexity: number;
  kind: "simple" | "compound";
}

export const CELLS: Record<CellId, Cell> = {
  ta: { len: 1, notes: [[0, 1]], complexity: 0, kind: "simple" },
  titi: { len: 1, notes: [[0, 0.5], [0.5, 0.5]], complexity: 0.1, kind: "simple" },
  tikatika: { len: 1, notes: [[0, 0.25], [0.25, 0.25], [0.5, 0.25], [0.75, 0.25]], complexity: 0.65, kind: "simple" },
  titika: { len: 1, notes: [[0, 0.5], [0.5, 0.25], [0.75, 0.25]], complexity: 0.5, kind: "simple" },
  tikati: { len: 1, notes: [[0, 0.25], [0.25, 0.25], [0.5, 0.5]], complexity: 0.5, kind: "simple" },
  timri: { len: 1, notes: [[0, 0.75], [0.75, 0.25]], complexity: 0.6, kind: "simple" },
  rest: { len: 1, notes: [], complexity: 0.2, kind: "simple" },
  taa: { len: 2, notes: [[0, 2]], complexity: 0, kind: "simple" },
  dotted: { len: 2, notes: [[0, 1.5], [1.5, 0.5]], complexity: 0.35, kind: "simple" },
  syncopa: { len: 2, notes: [[0, 0.5], [0.5, 1], [1.5, 0.5]], complexity: 0.6, kind: "simple" },
  taaa: { len: 3, notes: [[0, 3]], complexity: 0, kind: "simple" },
  whole: { len: 4, notes: [[0, 4]], complexity: 0, kind: "simple" },
  dq: { len: 1.5, notes: [[0, 1.5]], complexity: 0, kind: "compound" },
  qe: { len: 1.5, notes: [[0, 1], [1, 0.5]], complexity: 0.1, kind: "compound" },
  eee: { len: 1.5, notes: [[0, 0.5], [0.5, 0.5], [1, 0.5]], complexity: 0.15, kind: "compound" },
  eq: { len: 1.5, notes: [[0, 0.5], [0.5, 1]], complexity: 0.4, kind: "compound" },
};

/** Bars a theme statement occupies: about one 4/4 bar's worth (or two) of music per profile. */
export function themeBars(g: MotifGrammar, meter: MeterId): number {
  const bb = barBeats(meter);
  const want = g.bars * 4;
  return Math.max(1, Math.min(4, Math.round(want / bb)));
}

/** A rhythm of `bars` bars assembled from cells. `long` biases the final group to a long note;
 *  `complexity` (0..1) shifts weight from plain to intricate cells; `busy` (−1..1) shifts toward
 *  fewer or more notes (used for contrast themes). */
export function cellRhythm(r: Rng, g: MotifGrammar, meter: MeterId, bars: number, complexity: number, busy = 0): { at: number; dur: number; cell: CellId }[] {
  const bb = barBeats(meter);
  const groups = cellGroups(meter);
  const eighthBased = METERS[meter].pulse === 0.5;
  const out: { at: number; dur: number; cell: CellId }[] = [];
  const { items, weights } = entries(g.cells);
  for (let b = 0; b < bars; b++) {
    let pos = 0;
    let gi = 0;
    while (gi < groups.length) {
      const glen = groups[gi];
      const fits = items.map((id, i) => {
        const c = CELLS[id];
        // a rest fills any one group; a sounding cell must match the group(s) it fills: compound
        // cells take 3-eighth groups, 1-beat simple cells take quarter beats and 2-eighth groups,
        // and longer simple cells (ta-a, syn-co-pa) span several quarter beats
        const len = id === "rest" ? glen : c.len;
        let span = 0;
        let k = gi;
        while (k < groups.length && span < len - 1e-6) span += groups[k++];
        if (Math.abs(span - len) > 1e-6) return 0;
        if (id !== "rest") {
          if (c.kind === "compound" && glen !== 1.5) return 0;
          if (c.kind === "simple" && (glen !== 1 || (eighthBased && c.len > 1))) return 0;
        }
        const final = b === bars - 1 && k === groups.length;
        let w = weights[i];
        w *= 1 + (complexity - 0.5) * 2 * (c.complexity - 0.3);
        w *= Math.pow(1.6, busy * (c.notes.length - 1.5));
        // a phrase of speech ends on a long syllable; it does not start with silence
        if (final) w *= c.notes.length === 1 ? 3 : c.notes.length === 0 ? 0 : 0.35;
        if (b === 0 && pos === 0 && c.notes.length === 0) w *= 0.15;
        return Math.max(0, w);
      });
      const pick: CellId = fits.every((w) => w <= 0) ? (glen === 1.5 ? "dq" : "ta") : r.weighted(items, fits);
      const c = CELLS[pick];
      for (const [at, dur] of c.notes) out.push({ at: b * bb + pos + at, dur, cell: pick });
      const len = pick === "rest" ? glen : c.len;
      let covered = 0;
      while (gi < groups.length && covered < len - 1e-6) covered += groups[gi++];
      pos += covered;
    }
  }
  if (!out.length) out.push({ at: 0, dur: Math.min(bb, 1), cell: "ta" });
  return out;
}

/** The units a bar is filled with: quarter beats in x/4 meters, 2- and 3-eighth groups in x/8. */
export function cellGroups(meter: MeterId): number[] {
  const info = METERS[meter];
  if (info.pulse === 1) return Array.from({ length: Math.round(info.barBeats) }, () => 1);
  return groupLengths(meter);
}

// ------------------------------------------------------------------ contours

/** Children's chant shapes, in pentatonic degrees relative to the fifth (sol in do-pentatonic,
 *  mi in la-pentatonic): sol–mi, sol–sol–mi, sol–mi–la–sol–mi, mi–re–do … */
const CHANTS: number[][] = [
  [0, -1], [0, 0, -1], [0, -1, 1, 0, -1], [0, 1, 0, -1], [-1, -2, -3], [-3, -2, -1, 0], [0, -1, -2, -3],
  [1, 0, -1, -2, -3], [-3, -1, 0, 1, 0], [0, 2, 1, 0], [-1, 0, 1, 0, -1], [0, 0, 1, 1, 0], [-3, -3, -1, 0],
];

const MAJ_PENT = [0, 2, 4, 7, 9];
const MIN_PENT = [0, 3, 5, 7, 10];

/** Pentatonic chant degrees → steps in the actual scale (the nearest scale tone to each chant pitch). */
function chantToSteps(chant: number[], scale: ScaleId, custom?: number[]): number[] {
  const pent = isMinorish(scale, custom) ? MIN_PENT : MAJ_PENT;
  const iv = scaleIntervals(scale, custom);
  const n = iv.length;
  const semis = (pd: number) => {
    const d = pd + 3; // relative to the fifth (index 3 of the pentatonic)
    const o = Math.floor(d / 5);
    return pent[((d % 5) + 5) % 5] + 12 * o;
  };
  const toDeg = (s: number) => {
    const o = Math.floor(s / 12);
    const pc = s - o * 12;
    let best = 0;
    for (let i = 0; i < n; i++) if (Math.abs(iv[i] - pc) < Math.abs(iv[best] - pc)) best = i;
    return best + o * n;
  };
  const anchor = toDeg(semis(0));
  return chant.map((c) => toDeg(semis(c)) - anchor);
}

function shapeSteps(contour: Contour, count: number, leap: number, range: number, r: Rng, scale: ScaleId, custom?: number[]): number[] {
  if (contour === "chant") {
    const fitting = CHANTS.filter((c) => c.length <= count + 1);
    let steps = chantToSteps(r.pick(fitting.length ? fitting : CHANTS), scale, custom).slice(0, count);
    while (steps.length < count) {
      // extend by neighbour motion around the last two tones (how chants grow)
      const a = steps[steps.length - 1];
      const b = steps.length > 1 ? steps[steps.length - 2] : a + 1;
      steps.push(r.chance(0.6) ? b : a + r.pick([-1, 1]));
    }
    return clampSteps(steps, range);
  }
  if (contour === "cell") {
    // small repeating cell: a narrow figure around the anchor (minimalism)
    const pool = [0, 1, 2, -1, 3];
    const steps = [0];
    for (let k = 1; k < count; k++) steps.push(r.pick(pool.filter((x) => Math.abs(x - steps[k - 1]) <= 3)));
    return steps;
  }
  const shape = contour === "arch" ? r.pick(["arch", "arch", "rise", "valley"] as const) : contour === "wave" ? r.pick(["wave", "turn", "arch"] as const) : contour === "leap" ? r.pick(["wave", "arch", "valley", "rise", "fall"] as const) : r.pick(["fall", "rise", "arch"] as const);
  const steps = [0];
  for (let k = 1; k < count; k++) {
    const f = k / Math.max(1, count - 1);
    let dir = shape === "rise" ? 1 : shape === "fall" ? -1 : shape === "arch" ? (f <= 0.55 ? 1 : -1) : shape === "valley" ? (f <= 0.55 ? -1 : 1) : shape === "wave" ? (k % 2 ? 1 : -1) : k === 1 ? 1 : -1;
    const prevLeap = k > 1 && Math.abs(steps[k - 1] - steps[k - 2]) >= 3;
    if (prevLeap) dir = -Math.sign(steps[k - 1] - steps[k - 2]) || dir; // gap fill after a leap
    const size = !prevLeap && r.chance(leap) ? r.pick([3, 4]) : r.chance(0.72) ? 1 : 2;
    steps.push(steps[k - 1] + dir * size);
  }
  return clampSteps(steps, range);
}

function clampSteps(steps: number[], range: number): number[] {
  const lo = Math.min(...steps);
  const hi = Math.max(...steps);
  if (hi - lo <= range) return steps;
  const f = range / (hi - lo);
  return steps.map((s) => Math.round(s * f));
}

export interface ThemeOptions {
  grammar: MotifGrammar;
  meter: MeterId;
  scale: ScaleId;
  custom?: number[];
  complexity: number;
  /** −1 fewer/longer notes … +1 more/shorter */
  busy?: number;
  /** force the contour's general direction (contrast themes) */
  invertOf?: Motif;
}

export function inventTheme(id: string, r: Rng, o: ThemeOptions, origin = "invented"): ThemeRecord {
  const bars = themeBars(o.grammar, o.meter);
  const bb = barBeats(o.meter);
  const rhythm = cellRhythm(r, o.grammar, o.meter, bars, o.complexity, o.busy ?? 0);
  let steps = shapeSteps(o.grammar.contour, rhythm.length, o.grammar.leap, o.grammar.range, r, o.scale, o.custom);
  if (o.invertOf && o.invertOf.notes.length > 1) {
    // a contrasting theme moves against the first one: if A rose, B falls
    const dirA = Math.sign(o.invertOf.notes[o.invertOf.notes.length - 1].step - o.invertOf.notes[0].step);
    const dirB = Math.sign(steps[steps.length - 1] - steps[0]);
    if (dirA !== 0 && dirA === dirB) steps = steps.map((s) => -s);
  }
  const span = bars * bb;
  const notes: MotifNote[] = rhythm.map((x, k) => {
    const next = rhythm[k + 1]?.at ?? span;
    return { at: x.at, dur: Math.max(0.2, Math.min(x.dur, next - x.at)), step: steps[k] ?? 0 };
  });
  return { id, motif: { notes, span }, bars, origin };
}

/** A contrasting theme: the opposite rhythmic density and contour direction of the theme it answers. */
export function contrastTheme(id: string, of: ThemeRecord, r: Rng, o: ThemeOptions): ThemeRecord {
  const density = of.motif.notes.length / Math.max(1, of.motif.span);
  const busy = density > 1.6 ? -0.8 : density < 1 ? 0.8 : r.chance(0.5) ? 0.6 : -0.6;
  return inventTheme(id, r, { ...o, busy, invertOf: of.motif }, `contrast of ${of.id}`);
}

/** A new theme grown from an earlier one (through-composed forms): its rhythm with a new contour,
 *  its contour inverted on a new rhythm, or its head sequenced. */
export function deriveTheme(id: string, from: ThemeRecord, r: Rng, o: ThemeOptions): ThemeRecord {
  const m = from.motif;
  const headCount = m.notes.filter((n) => n.at < m.span / 2).length;
  const kinds = headCount >= 2 && m.notes.length >= 4 ? (["rhythm", "inversion", "head"] as const) : (["rhythm", "inversion"] as const);
  const kind = m.notes.length < 3 ? "inversion" : r.pick(kinds);
  if (kind === "rhythm") {
    const steps = shapeSteps(o.grammar.contour === "chant" ? "arch" : o.grammar.contour, m.notes.length, o.grammar.leap, o.grammar.range, r, o.scale, o.custom);
    return { id, motif: { span: m.span, notes: m.notes.map((n, k) => ({ ...n, step: steps[k] })) }, bars: from.bars, origin: `${from.id}'s rhythm, new contour` };
  }
  if (kind === "inversion") {
    const fresh = inventTheme(id, r, { ...o, busy: 0 });
    const inv = m.notes.map((n) => -n.step);
    return { ...fresh, motif: { span: fresh.motif.span, notes: fresh.motif.notes.map((n, k) => ({ ...n, step: inv[k % inv.length] })) }, origin: `${from.id} inverted, new rhythm` };
  }
  const head = m.notes.filter((n) => n.at < m.span / 2);
  const half = m.span / 2;
  const notes = [...head, ...head.map((n) => ({ ...n, at: n.at + half, step: n.step + 1 }))];
  return { id, motif: { span: m.span, notes }, bars: from.bars, origin: `${from.id}'s head in sequence` };
}

/** Interval-direction signature of a note list, for motif-continuity analysis. */
export function contour(midis: number[]): number[] {
  return midis.slice(1).map((m, i) => Math.sign(m - midis[i]));
}
