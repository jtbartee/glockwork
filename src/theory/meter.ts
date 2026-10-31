// METER. Adapted from APERTURE (src/core/time.ts) with the meters elemental music lives in —
// 2/4, 6/8 and 12/8 — and asymmetric 5/8. A meter is a bar length plus a grouping of the bar into
// pulses: that grouping is what makes 7/8 feel like 2+2+3 and 6/8 like two dotted quarters.

import type { Beats, MeterId } from "./types";

export interface MeterInfo {
  id: MeterId;
  num: number;
  den: number;
  /** bar length in quarter-note beats */
  barBeats: number;
  /** grouping of the bar in its own pulse unit (eighths for x/8, quarters for x/4) */
  groups: number[];
  /** pulse unit length in beats */
  pulse: number;
}

export const METERS: Record<MeterId, MeterInfo> = {
  "2/4": { id: "2/4", num: 2, den: 4, barBeats: 2, groups: [1, 1], pulse: 1 },
  "3/4": { id: "3/4", num: 3, den: 4, barBeats: 3, groups: [1, 1, 1], pulse: 1 },
  "4/4": { id: "4/4", num: 4, den: 4, barBeats: 4, groups: [1, 1, 1, 1], pulse: 1 },
  "5/4": { id: "5/4", num: 5, den: 4, barBeats: 5, groups: [3, 2], pulse: 1 },
  "6/8": { id: "6/8", num: 6, den: 8, barBeats: 3, groups: [3, 3], pulse: 0.5 },
  "9/8": { id: "9/8", num: 9, den: 8, barBeats: 4.5, groups: [3, 3, 3], pulse: 0.5 },
  "12/8": { id: "12/8", num: 12, den: 8, barBeats: 6, groups: [3, 3, 3, 3], pulse: 0.5 },
  "5/8": { id: "5/8", num: 5, den: 8, barBeats: 2.5, groups: [3, 2], pulse: 0.5 },
  "7/8": { id: "7/8", num: 7, den: 8, barBeats: 3.5, groups: [2, 2, 3], pulse: 0.5 },
};

export const METER_IDS = Object.keys(METERS) as MeterId[];

export const barBeats = (m: MeterId): Beats => METERS[m].barBeats;

/** A compound meter's felt beat is a dotted quarter (three eighths). */
export const isCompound = (m: MeterId): boolean => METERS[m].pulse === 0.5 && METERS[m].groups.every((g) => g === 3);

/** Beat positions (within one bar) where each metric group starts; index 0 is the downbeat. */
export function groupStarts(m: MeterId): Beats[] {
  const info = METERS[m];
  const out: Beats[] = [];
  let p = 0;
  for (const g of info.groups) {
    out.push(p * info.pulse);
    p += g;
  }
  return out;
}

/** Group lengths in beats (2+2+3 eighths → 1, 1, 1.5). */
export function groupLengths(m: MeterId): Beats[] {
  const info = METERS[m];
  return info.groups.map((g) => g * info.pulse);
}

/** Metric accent weight (0..1) for a position inside a bar: downbeat 1, group starts 0.75,
 *  pulse units 0.5, finer subdivisions lower. */
export function metricWeight(m: MeterId, posInBar: Beats): number {
  const info = METERS[m];
  const eps = 1e-6;
  if (Math.abs(posInBar) < eps) return 1;
  for (const g of groupStarts(m)) if (Math.abs(posInBar - g) < eps) return 0.75;
  const pu = posInBar / info.pulse;
  if (Math.abs(pu - Math.round(pu)) < eps) return 0.5;
  const half = posInBar / (info.pulse / 2);
  if (Math.abs(half - Math.round(half)) < eps) return 0.3;
  return 0.15;
}

/** Harmonic strength of a position for melody writing (where non-chord tones need a reason).
 *  Unlike metricWeight, a 4/4 bar is 1 · ½ · ¾ · ½ (beat 3 strong, 2 and 4 weak), 2/4 and 3/4 have
 *  one strong beat and 12/8 has a secondary accent on its third group. */
export function beatStrength(m: MeterId, posInBar: Beats): number {
  const w = metricWeight(m, posInBar);
  if (m === "4/4") return Math.abs(posInBar - 2) < 1e-6 ? 0.8 : w === 0.75 ? 0.5 : w;
  if (m === "12/8") return Math.abs(posInBar - 3) < 1e-6 ? 0.8 : w === 0.75 ? 0.5 : w;
  if (m === "3/4" || m === "2/4") return w === 0.75 ? 0.5 : w;
  return w;
}

export const secondsPerBeat = (bpm: number): number => 60 / bpm;

export function formatPosition(b: Beats, m: MeterId): string {
  const bb = barBeats(m);
  const bar = Math.floor(b / bb + 1e-9);
  const inBar = b - bar * bb;
  const info = METERS[m];
  const pulse = Math.floor(inBar / info.pulse + 1e-9);
  return `${bar + 1}.${pulse + 1}`;
}
