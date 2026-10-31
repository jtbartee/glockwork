// ENSEMBLE INSTRUMENT KNOWLEDGE. What each of GLOCKWORK's synthesis models is as a member of an
// ensemble: its sounding range as a real instrument (Orff barred instruments are notated an octave
// or two below sounding pitch — these ranges are sounding), the wider range the synthesis can
// reach when played as an electronic instrument, how many mallets a player holds, how fast one
// player can strike, and how well suited it is to each compositional role.
//
// Orff ranges follow the standard Studio 49 / Sonor diatonic instruments (c–a′ over 1 octave + 6th):
// soprano glockenspiel C6–A7, alto glockenspiel / soprano xylophone / soprano metallophone C5–A6,
// alto xylophone / metallophone C4–A5, bass xylophone / metallophone C3–A4. Concert instruments use
// their common professional ranges (4.3-octave marimba A2–C7, vibraphone F3–F6, xylophone F4–C8,
// orchestral bells G5–C8, crotales C6–C8, tubular bells C4–F5, celesta C4–C8).

import { getInstrument, INSTRUMENTS } from "../audio/instruments";
import { decaySeconds } from "../audio/mapping";
import type { EngineParams } from "../audio/types";
import type { RoleId } from "./types";

export type Family = "wood" | "metal" | "glass" | "electronic";
export type Sustain = "short" | "medium" | "long";

export interface EnsembleInstrument {
  id: string;
  /** conventional abbreviation used in Orff scores (BX, AM, SG …) */
  short: string;
  family: Family;
  sustain: Sustain;
  orffRange: [number, number];
  extRange: [number, number];
  /** simultaneous notes one player can strike */
  mallets: number;
  /** shortest time between two strikes by one player, seconds */
  minGap: number;
  /** relative loudness at equal velocity (gain staging) */
  level: number;
  fitness: Partial<Record<RoleId, number>>;
}

const E = (id: string, short: string, family: Family, sustain: Sustain, orffRange: [number, number], extRange: [number, number], mallets: number, minGap: number, level: number, fitness: Partial<Record<RoleId, number>>): EnsembleInstrument => ({
  id, short, family, sustain, orffRange, extRange, mallets, minGap, level, fitness,
});

export const ENSEMBLE_INSTRUMENTS: Record<string, EnsembleInstrument> = Object.fromEntries(
  [
    E("orff-soprano-glock", "SG", "metal", "long", [84, 105], [79, 108], 2, 0.065, 0.62,
      { texture: 0.95, secondary: 0.6, melody: 0.45, experimental: 0.5, punctuation: 0.35, ostinato: 0.35, arpeggio: 0.3, counter: 0.2, harmony: 0.15 }),
    E("orff-alto-glock", "AG", "metal", "long", [72, 93], [67, 100], 2, 0.065, 0.66,
      { texture: 0.9, secondary: 0.65, melody: 0.55, experimental: 0.5, ostinato: 0.45, arpeggio: 0.4, punctuation: 0.3, counter: 0.3, harmony: 0.2 }),
    E("orff-soprano-xylo", "SX", "wood", "short", [72, 93], [67, 100], 2, 0.065, 0.9,
      { melody: 0.95, secondary: 0.8, ostinato: 0.6, counter: 0.55, arpeggio: 0.55, experimental: 0.5, punctuation: 0.4, texture: 0.25, harmony: 0.2 }),
    E("orff-alto-xylo", "AX", "wood", "short", [60, 81], [53, 88], 2, 0.065, 0.95,
      { ostinato: 0.95, counter: 0.8, arpeggio: 0.75, melody: 0.7, secondary: 0.7, bordun: 0.55, punctuation: 0.5, experimental: 0.45, harmony: 0.4, bass: 0.2 }),
    E("orff-bass-xylo", "BX", "wood", "short", [48, 69], [40, 74], 2, 0.1, 1.0,
      { bordun: 0.95, bass: 0.95, punctuation: 0.6, ostinato: 0.5, counter: 0.25, harmony: 0.2 }),
    E("orff-soprano-metal", "SM", "metal", "long", [72, 93], [67, 100], 2, 0.07, 0.7,
      { harmony: 0.75, texture: 0.7, secondary: 0.65, melody: 0.55, counter: 0.5, experimental: 0.5, arpeggio: 0.45, ostinato: 0.4 }),
    E("orff-alto-metal", "AM", "metal", "long", [60, 81], [53, 88], 2, 0.07, 0.75,
      { harmony: 0.9, bordun: 0.8, counter: 0.7, ostinato: 0.6, secondary: 0.6, melody: 0.55, arpeggio: 0.5, texture: 0.5, bass: 0.3 }),
    E("orff-bass-metal", "BM", "metal", "long", [48, 69], [40, 74], 2, 0.1, 0.8,
      { bordun: 0.95, bass: 0.9, harmony: 0.45, texture: 0.3 }),
    E("concert-xylo", "Xyl", "wood", "short", [65, 108], [60, 108], 2, 0.06, 0.85,
      { melody: 0.85, secondary: 0.7, arpeggio: 0.7, ostinato: 0.65, counter: 0.55, punctuation: 0.55, experimental: 0.55 }),
    E("marimba", "Mar", "wood", "medium", [45, 96], [36, 96], 4, 0.06, 0.95,
      { arpeggio: 0.95, ostinato: 0.85, counter: 0.8, bass: 0.75, harmony: 0.75, melody: 0.75, bordun: 0.65, secondary: 0.65 }),
    E("vibraphone", "Vib", "metal", "long", [53, 89], [48, 96], 4, 0.06, 0.7,
      { harmony: 0.95, melody: 0.8, counter: 0.75, secondary: 0.65, texture: 0.6, arpeggio: 0.6, ostinato: 0.45 }),
    E("orchestral-bells", "Glk", "metal", "long", [79, 108], [72, 108], 2, 0.065, 0.6,
      { texture: 0.9, secondary: 0.6, melody: 0.55, experimental: 0.5, punctuation: 0.35 }),
    E("crotales", "Crt", "metal", "long", [84, 108], [79, 108], 2, 0.08, 0.55,
      { texture: 0.95, experimental: 0.55, punctuation: 0.5, secondary: 0.35 }),
    E("tubular-bells", "Tub", "metal", "long", [60, 77], [53, 84], 2, 0.25, 0.6,
      { punctuation: 0.85, texture: 0.7, harmony: 0.3, bass: 0.2, melody: 0.2 }),
    E("celesta", "Cel", "metal", "medium", [60, 108], [48, 108], 6, 0.05, 0.75,
      { arpeggio: 0.8, melody: 0.75, secondary: 0.7, texture: 0.6, harmony: 0.55, counter: 0.55, ostinato: 0.55 }),
    E("kalimba", "Kal", "metal", "medium", [60, 88], [55, 93], 2, 0.07, 0.85,
      { ostinato: 0.9, arpeggio: 0.75, melody: 0.6, experimental: 0.6, counter: 0.55, secondary: 0.5 }),
    E("toy-piano", "Toy", "metal", "short", [65, 89], [60, 96], 4, 0.06, 0.8,
      { experimental: 0.8, melody: 0.55, ostinato: 0.55, secondary: 0.55, texture: 0.45 }),
    E("steel-tongue", "STD", "metal", "long", [57, 81], [50, 86], 2, 0.08, 0.75,
      { ostinato: 0.7, texture: 0.65, experimental: 0.6, melody: 0.55, harmony: 0.5, bordun: 0.45, counter: 0.45 }),
    E("wooden-tongue", "WTD", "wood", "short", [48, 67], [43, 72], 2, 0.08, 0.95,
      { punctuation: 0.95, ostinato: 0.6, experimental: 0.5, bass: 0.45, bordun: 0.4 }),
    E("bell", "Bell", "metal", "long", [60, 96], [55, 100], 2, 0.12, 0.55,
      { texture: 0.8, punctuation: 0.65, harmony: 0.4, melody: 0.35 }),
    E("glass-mallet", "Gls", "glass", "long", [60, 100], [48, 108], 4, 0.06, 0.6,
      { experimental: 0.85, texture: 0.8, melody: 0.5, harmony: 0.5, secondary: 0.5 }),
    E("synthetic-mallet", "Syn", "electronic", "medium", [36, 96], [28, 108], 6, 0.04, 0.7,
      { experimental: 0.95, ostinato: 0.65, arpeggio: 0.6, bass: 0.5, melody: 0.5 }),
  ].map((e) => [e.id, e]),
);

export function ensembleInfo(id: string): EnsembleInstrument {
  return ENSEMBLE_INSTRUMENTS[id] ?? ENSEMBLE_INSTRUMENTS["orff-alto-xylo"];
}

export const ENSEMBLE_IDS = INSTRUMENTS.map((i) => i.id).filter((id) => ENSEMBLE_INSTRUMENTS[id]);

export function instrumentName(id: string): string {
  return getInstrument(id).name;
}

/** Sounding range of an instrument under the chosen realism. */
export function instrumentRange(id: string, realism: "orff" | "extended"): [number, number] {
  const e = ensembleInfo(id);
  return realism === "orff" ? e.orffRange : e.extRange;
}

/** The register band each role prefers (sounding MIDI). */
export const ROLE_BAND: Record<RoleId, [number, number]> = {
  bass: [36, 62],
  bordun: [43, 69],
  ostinato: [55, 81],
  melody: [64, 93],
  secondary: [60, 96],
  counter: [55, 81],
  harmony: [55, 84],
  arpeggio: [52, 88],
  punctuation: [40, 79],
  texture: [76, 108],
  experimental: [48, 100],
};

/** The range a track writes in: its instrument's range narrowed to the role's band when that still
 *  leaves room for music (a 9th), otherwise the instrument's own range — the role adapts. */
export function partRange(id: string, role: RoleId, realism: "orff" | "extended"): [number, number] {
  const [lo, hi] = instrumentRange(id, realism);
  const [blo, bhi] = ROLE_BAND[role];
  const a = Math.max(lo, blo);
  const b = Math.min(hi, bhi);
  return b - a >= 14 ? [a, b] : [lo, hi];
}

/** Approximate seconds a struck note stays clearly audible (≈ −20 dB) for a patch: the fundamental
 *  decays with time constant decay/4, so −20 dB is reached at ≈ 0.58 × decay. */
export function ringSeconds(engine: EngineParams): number {
  return decaySeconds(engine.bar.decay) * 0.58;
}

/** Seconds until a voice is inaudible (≈ −70 dB, e^−8): how long the mixer keeps it alive. */
export function tailSeconds(engine: EngineParams): number {
  return decaySeconds(engine.bar.decay) * 2;
}

/** Damping decision shared by the mixer and analysis: does a note sound past its written length? */
export function dampsAtNoteEnd(damp: "auto" | "ring" | "damp", role: RoleId, instrumentId: string): boolean {
  if (damp !== "auto") return damp === "damp";
  const e = ensembleInfo(instrumentId);
  // a long-ringing bar is damped by hand where harmony changes under it; textures and bells ring
  if (e.sustain === "short") return false;
  return role !== "texture" && role !== "punctuation" && role !== "experimental";
}
