export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function invLerp(a: number, b: number, v: number): number {
  if (a === b) return 0;
  return clamp((v - a) / (b - a), 0, 1);
}

/** Maps a 0..1 knob position to a log-scaled frequency range. */
export function logScale(t: number, min: number, max: number): number {
  const t2 = clamp(t, 0, 1);
  return min * Math.pow(max / min, t2);
}

export function inverseLogScale(value: number, min: number, max: number): number {
  const v = clamp(value, min, max);
  return Math.log(v / min) / Math.log(max / min);
}

export function midiToFreq(note: number, a4 = 440): number {
  return a4 * Math.pow(2, (note - 69) / 12);
}

export function centsToRatio(cents: number): number {
  return Math.pow(2, cents / 1200);
}

export function semitonesToRatio(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

export function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

let idCounter = 0;
export function uid(prefix = "id"): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}
