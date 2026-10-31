// RHYTHM. Euclidean distribution and rotation adapted from APERTURE (src/theory/rhythm.ts).

import type { Beats } from "./types";

/** Bjorklund/Euclidean distribution of `pulses` onsets over `steps`, rotated (Bresenham form, first
 *  onset on step 0; rotation moves the pattern later). E(3,8) is the tresillo x..x..x. */
export function euclid(pulses: number, steps: number, rotation = 0): boolean[] {
  const n = Math.max(1, Math.round(steps));
  const k = Math.max(0, Math.min(n, Math.round(pulses)));
  const out: boolean[] = [];
  for (let i = 0; i < n; i++) out.push(k > 0 && (i * k) % n < k);
  return rotate(out, rotation);
}

export function rotate<T>(xs: T[], r: number): T[] {
  const n = xs.length;
  if (!n) return xs;
  const k = ((r % n) + n) % n;
  return [...xs.slice(n - k), ...xs.slice(0, n - k)];
}

/** k-against-n polyrhythm onsets over one cycle of `cycle` beats. */
export function polyrhythm(k: number, cycle: Beats): Beats[] {
  return Array.from({ length: k }, (_, i) => (i * cycle) / k);
}

export function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

export const lcm = (a: number, b: number): number => Math.abs(Math.round(a) * Math.round(b)) / gcd(a, b);
