// SCALES. Adapted from APERTURE (src/theory/scales.ts). Added for elemental (Orff) music: the five
// rotations of the pentatonic — do (major), re, mi, sol, la (minor) — and the do-hexachord that
// Schulwerk volumes step through before the full modes; plus hemitonic pentatonics (hirajoshi,
// in-sen, kumoi, pelog approximations) for the Experimental profile.

import type { ScaleId } from "./types";

export interface ScaleDef {
  id: ScaleId;
  name: string;
  intervals: number[];
}

export const SCALES: Record<ScaleId, ScaleDef> = {
  majorPent: { id: "majorPent", name: "Do pentatonic (major)", intervals: [0, 2, 4, 7, 9] },
  minorPent: { id: "minorPent", name: "La pentatonic (minor)", intervals: [0, 3, 5, 7, 10] },
  rePent: { id: "rePent", name: "Re pentatonic", intervals: [0, 2, 5, 7, 10] },
  solPent: { id: "solPent", name: "Sol pentatonic", intervals: [0, 2, 5, 7, 9] },
  miPent: { id: "miPent", name: "Mi pentatonic", intervals: [0, 3, 5, 8, 10] },
  hexatonic: { id: "hexatonic", name: "Do hexachord", intervals: [0, 2, 4, 5, 7, 9] },
  major: { id: "major", name: "Major (Ionian)", intervals: [0, 2, 4, 5, 7, 9, 11] },
  minor: { id: "minor", name: "Natural minor (Aeolian)", intervals: [0, 2, 3, 5, 7, 8, 10] },
  dorian: { id: "dorian", name: "Dorian", intervals: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { id: "phrygian", name: "Phrygian", intervals: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { id: "lydian", name: "Lydian", intervals: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { id: "mixolydian", name: "Mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10] },
  locrian: { id: "locrian", name: "Locrian", intervals: [0, 1, 3, 5, 6, 8, 10] },
  harmonicMinor: { id: "harmonicMinor", name: "Harmonic minor", intervals: [0, 2, 3, 5, 7, 8, 11] },
  melodicMinor: { id: "melodicMinor", name: "Melodic minor", intervals: [0, 2, 3, 5, 7, 9, 11] },
  phrygianDominant: { id: "phrygianDominant", name: "Phrygian dominant", intervals: [0, 1, 4, 5, 7, 8, 10] },
  lydianDominant: { id: "lydianDominant", name: "Lydian dominant", intervals: [0, 2, 4, 6, 7, 9, 10] },
  majorBlues: { id: "majorBlues", name: "Major blues", intervals: [0, 2, 3, 4, 7, 9] },
  minorBlues: { id: "minorBlues", name: "Minor blues", intervals: [0, 3, 5, 6, 7, 10] },
  hirajoshi: { id: "hirajoshi", name: "Hirajōshi", intervals: [0, 2, 3, 7, 8] },
  inSen: { id: "inSen", name: "In-sen", intervals: [0, 1, 5, 7, 10] },
  kumoi: { id: "kumoi", name: "Kumoi", intervals: [0, 2, 3, 7, 9] },
  pelog: { id: "pelog", name: "Pelog (approx.)", intervals: [0, 1, 3, 7, 8] },
  wholeTone: { id: "wholeTone", name: "Whole tone", intervals: [0, 2, 4, 6, 8, 10] },
  octatonic: { id: "octatonic", name: "Octatonic (half–whole)", intervals: [0, 1, 3, 4, 6, 7, 9, 10] },
  chromatic: { id: "chromatic", name: "Chromatic", intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  custom: { id: "custom", name: "Custom", intervals: [0, 2, 4, 7, 9] },
};

export const SCALE_IDS = Object.keys(SCALES) as ScaleId[];

const SHARP = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const FLAT = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
/** Key roots conventionally spelled with flats in major-family and minor-family keys. */
const FLAT_MAJOR = new Set([5, 10, 3, 8, 1, 6]);
const FLAT_MINOR = new Set([2, 7, 0, 5, 10, 3]);

export const KEY_NAMES = ["C", "C♯/D♭", "D", "E♭", "E", "F", "F♯/G♭", "G", "A♭", "A", "B♭", "B"];

const mod12 = (x: number) => ((x % 12) + 12) % 12;

export function isMinorish(scale: ScaleId, custom?: number[]): boolean {
  const iv = scaleIntervals(scale, custom);
  return iv.includes(3) && !iv.includes(4);
}

/** Practical enharmonic spelling: flats for flat keys (F, B♭, E♭… / d, g, c… minor), sharps otherwise. */
export function prefersFlats(root: number, scale: ScaleId): boolean {
  return isMinorish(scale) ? FLAT_MINOR.has(root) : FLAT_MAJOR.has(root);
}

export function pcName(pc: number, root = 0, scale: ScaleId = "major"): string {
  return (prefersFlats(root, scale) ? FLAT : SHARP)[mod12(pc)];
}

export function midiName(m: number, root = 0, scale: ScaleId = "major"): string {
  return `${pcName(m, root, scale)}${Math.floor(m / 12) - 1}`;
}

export function keyLabel(root: number, scale: ScaleId): string {
  return `${pcName(root, root, scale)} ${SCALES[scale].name}`;
}

export function scaleIntervals(scale: ScaleId, custom?: number[]): number[] {
  if (scale === "custom") {
    const c = [...new Set((custom?.length ? custom : SCALES.custom.intervals).map(mod12))].sort((a, b) => a - b);
    return c.length ? c : [0];
  }
  return SCALES[scale].intervals;
}

/** Pitch classes (absolute, 0..11) of a key + scale, in degree order. */
export function pitchClasses(root: number, scale: ScaleId, custom?: number[]): number[] {
  return scaleIntervals(scale, custom).map((i) => mod12(root + i));
}

export function inScale(midi: number, root: number, scale: ScaleId, custom?: number[]): boolean {
  return scaleIntervals(scale, custom).includes(mod12(midi - root));
}

export function snapToScale(midi: number, root: number, scale: ScaleId, custom?: number[]): number {
  const iv = scaleIntervals(scale, custom);
  for (let d = 0; d <= 6; d++) {
    if (iv.includes(mod12(midi - d - root))) return midi - d;
    if (iv.includes(mod12(midi + d - root))) return midi + d;
  }
  return midi;
}

/** Scale degree → MIDI. Degree 0 is the tonic in the octave starting at `base` (a MIDI note ≤ tonic). */
export function degreeToMidi(degree: number, root: number, scale: ScaleId, base: number, custom?: number[]): number {
  const iv = scaleIntervals(scale, custom);
  const n = iv.length;
  const oct = Math.floor(degree / n);
  const k = ((degree % n) + n) % n;
  const tonic = base + mod12(root - base);
  return tonic + iv[k] + 12 * oct;
}

/** Nearest scale degree for a MIDI note, relative to the tonic at `base`. */
export function midiToDegree(midi: number, root: number, scale: ScaleId, base: number, custom?: number[]): number {
  const iv = scaleIntervals(scale, custom);
  const tonic = base + mod12(root - base);
  const rel = midi - tonic;
  const oct = Math.floor(rel / 12);
  const pc = rel - oct * 12;
  let best = 0;
  for (let i = 0; i < iv.length; i++) if (Math.abs(iv[i] - pc) < Math.abs(iv[best] - pc)) best = i;
  return best + oct * iv.length;
}

/** Every pitch in [lo, hi] belonging to the scale, ascending. */
export function scalePitches(root: number, scale: ScaleId, lo: number, hi: number, custom?: number[]): number[] {
  const out: number[] = [];
  for (let m = lo; m <= hi; m++) if (inScale(m, root, scale, custom)) out.push(m);
  return out;
}

// ------------------------------------------------------------------ scale character
// Different scales need different harmony rules. A seven-note scale stacks thirds; pentatonic,
// blues, symmetric and custom scales do not, so harmony for them is chosen from chord shapes
// whose tones the scale actually contains (chords.ts).

export type ScaleFamily = "heptatonic" | "pentatonic" | "blues" | "symmetric" | "chromatic" | "other";

export function scaleFamily(scale: ScaleId, custom?: number[]): ScaleFamily {
  if (scale === "majorBlues" || scale === "minorBlues") return "blues";
  if (scale === "wholeTone" || scale === "octatonic") return "symmetric";
  if (scale === "chromatic") return "chromatic";
  const n = scaleIntervals(scale, custom).length;
  if (n === 7) return "heptatonic";
  if (n === 5) return "pentatonic";
  return n >= 11 ? "chromatic" : "other";
}

/** Anhemitonic: no semitones at all (the classic Orff pentatonics). Any two of its tones sound
 *  together without a minor-second rub, which is why canons over a bordun work in it. */
export function isAnhemitonic(scale: ScaleId, custom?: number[]): boolean {
  const pcs = scaleIntervals(scale, custom);
  return pcs.every((a) => pcs.every((b) => mod12(a - b) !== 1));
}

/** Modes whose identity comes from one or two "colour" tones rather than a leading-tone cadence. */
export const MODAL_SCALES = new Set<ScaleId>(["dorian", "phrygian", "lydian", "mixolydian", "locrian", "phrygianDominant", "lydianDominant"]);

/** Intervals above the tonic that give a scale its character (what makes Dorian not minor). */
export const CHARACTERISTIC: Partial<Record<ScaleId, number[]>> = {
  major: [4, 11], minor: [8], harmonicMinor: [8, 11], melodicMinor: [9, 11], dorian: [9], phrygian: [1],
  lydian: [6], mixolydian: [10], locrian: [1, 6], phrygianDominant: [1, 4], lydianDominant: [6, 10], minorBlues: [6], majorBlues: [3],
  wholeTone: [6, 8], octatonic: [3, 6], majorPent: [4, 9], minorPent: [3, 10], rePent: [5, 10], solPent: [5, 9], miPent: [3, 8],
  hirajoshi: [3, 8], inSen: [1, 10], kumoi: [3, 9], pelog: [1, 8],
};

export function characteristicPcs(root: number, scale: ScaleId): number[] {
  return (CHARACTERISTIC[scale] ?? []).map((i) => mod12(root + i));
}

const ORD = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];
const INTERVAL_NAME = ["root", "♭9", "9th", "♯9 / minor 3rd", "third", "4th / 11th", "♯11 / ♭5", "fifth", "♯5 / ♭13", "6th / 13th", "7th", "major 7th"];

/** "6th degree" for a pitch class of the scale, or null when it is outside the scale. */
export function degreeOrdinal(pc: number, root: number, scale: ScaleId, custom?: number[]): string | null {
  const iv = scaleIntervals(scale, custom);
  const k = iv.indexOf(mod12(pc - root));
  return k < 0 ? null : `${ORD[k] ?? `${k + 1}th`} degree`;
}

export const intervalName = (semis: number): string => INTERVAL_NAME[mod12(semis)];
