export interface ScaleDef {
  id: string;
  name: string;
  /** Semitone offsets from the root, within one octave. */
  intervals: number[];
}

export const SCALES: ScaleDef[] = [
  { id: "chromatic", name: "Chromatic", intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { id: "major", name: "Major", intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: "natural-minor", name: "Natural Minor", intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: "major-pentatonic", name: "Major Pentatonic", intervals: [0, 2, 4, 7, 9] },
  { id: "minor-pentatonic", name: "Minor Pentatonic", intervals: [0, 3, 5, 7, 10] },
  { id: "dorian", name: "Dorian", intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: "mixolydian", name: "Mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10] },
  { id: "lydian", name: "Lydian", intervals: [0, 2, 4, 6, 7, 9, 11] },
];

export function getScale(id: string): ScaleDef {
  return SCALES.find((s) => s.id === id) ?? SCALES[0];
}

/** Quantizes a MIDI note into the given root/scale by snapping to the nearest in-scale
 * note, searching outward by semitone. Ties prefer the upward neighbor. */
export function quantizeToScale(note: number, root: number, scale: ScaleDef): number {
  if (scale.id === "chromatic") return note;
  const rootPc = ((root % 12) + 12) % 12;
  const inScale = new Set(scale.intervals.map((iv) => (rootPc + iv) % 12));
  const pc = ((note % 12) + 12) % 12;
  if (inScale.has(pc)) return note;

  for (let d = 1; d <= 6; d++) {
    const up = ((pc + d) % 12 + 12) % 12;
    if (inScale.has(up)) return note + d;
    const down = ((pc - d) % 12 + 12) % 12;
    if (inScale.has(down)) return note - d;
  }
  return note;
}
