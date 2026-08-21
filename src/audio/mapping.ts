import { logScale, clamp, lerp } from "../utils/math";
import type { MaterialId } from "./types";

/** Central place for turning normalized 0..1 knob values into physical units.
 * Keeping this separate from voice.ts makes the mapping easy to audit and reuse in the UI. */

export function decaySeconds(decay01: number): number {
  return logScale(clamp(decay01, 0, 1), 0.12, 9);
}

export function attackSeconds(attack01: number): number {
  // Higher "attack" value = sharper/faster transient.
  return lerp(0.045, 0.0015, clamp(attack01, 0, 1));
}

export function filterCutoffHz(t: number): number {
  return logScale(clamp(t, 0, 1), 180, 17000);
}

export function filterQ(t: number): number {
  return lerp(0.4, 13, clamp(t, 0, 1));
}

export function motorHz(speed01: number): number {
  return logScale(clamp(speed01, 0, 1), 0.4, 8.5);
}

export function bodyResonanceHz(bodySize01: number, fundamentalHz: number): number {
  // Larger bodies resonate lower relative to the fundamental.
  const ratio = lerp(0.9, 0.35, clamp(bodySize01, 0, 1));
  return Math.max(40, fundamentalHz * ratio);
}

interface MaterialColor {
  /** Noise excitation bandpass center, relative multiplier of fundamental. */
  noiseCenterMul: number;
  noiseQ: number;
  /** Extra inharmonic stretch exponent applied per material "color". */
  stretch: number;
  /** Saturation curve amount used for this material's excitation character. */
  grit: number;
}

const MATERIAL_COLORS: Record<MaterialId, MaterialColor> = {
  wood: { noiseCenterMul: 3, noiseQ: 0.6, stretch: 0.015, grit: 0.15 },
  rosewood: { noiseCenterMul: 2.5, noiseQ: 0.7, stretch: 0.012, grit: 0.1 },
  synthetic: { noiseCenterMul: 5, noiseQ: 1.2, stretch: 0.04, grit: 0.35 },
  metalSoft: { noiseCenterMul: 8, noiseQ: 1.8, stretch: 0.02, grit: 0.08 },
  metalBright: { noiseCenterMul: 14, noiseQ: 2.4, stretch: 0.03, grit: 0.05 },
  steel: { noiseCenterMul: 10, noiseQ: 2.0, stretch: 0.022, grit: 0.06 },
  bronze: { noiseCenterMul: 7, noiseQ: 1.6, stretch: 0.045, grit: 0.1 },
  glass: { noiseCenterMul: 18, noiseQ: 3.2, stretch: 0.05, grit: 0.03 },
  digital: { noiseCenterMul: 9, noiseQ: 0.9, stretch: 0.08, grit: 0.4 },
};

export function materialColor(material: MaterialId): MaterialColor {
  return MATERIAL_COLORS[material] ?? MATERIAL_COLORS.wood;
}

/** Stretches a partial ratio away from a pure harmonic series (piano/bell-style inharmonicity curve). */
export function stretchRatio(ratio: number, partialIndex: number, inharmonicity01: number, materialStretch: number): number {
  const amount = clamp(inharmonicity01, 0, 1) * materialStretch;
  const n = partialIndex + 1;
  return ratio * Math.sqrt(1 + amount * n * n);
}
