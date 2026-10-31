// Shared types of the theory layer. Adapted from APERTURE (src/core/types.ts, harmony section):
// a chord's sounding pitch classes are the single truth, and a timeline of ChordSlots is the one
// harmony every part of a piece reads.

/** Time in quarter-note beats. */
export type Beats = number;

export type ScaleId =
  | "major"
  | "minor"
  | "harmonicMinor"
  | "melodicMinor"
  | "dorian"
  | "phrygian"
  | "lydian"
  | "mixolydian"
  | "locrian"
  | "majorPent"
  | "minorPent"
  | "rePent"
  | "solPent"
  | "miPent"
  | "hexatonic"
  | "majorBlues"
  | "minorBlues"
  | "wholeTone"
  | "chromatic"
  | "octatonic"
  | "phrygianDominant"
  | "lydianDominant"
  | "hirajoshi"
  | "inSen"
  | "kumoi"
  | "pelog"
  | "custom";

export type MeterId = "2/4" | "3/4" | "4/4" | "5/4" | "6/8" | "9/8" | "12/8" | "5/8" | "7/8";

export type ChordQuality =
  | "maj" | "min" | "dim" | "aug" | "sus2" | "sus4" | "maj7" | "min7" | "dom7" | "min9" | "maj9"
  | "add9" | "min7b5" | "quartal" | "cluster" | "maj7s11" | "min11"
  | "five" | "six" | "min6" | "dom9" | "sus7" | "madd9" | "dim7" | "aug7" | "dom7b5" | "quartal3" | "six9" | "minMaj7" | "maj7s5" | "other";

export interface Chord {
  /** scale degree of the root (0-based; -1 for a root outside the scale) */
  degree: number;
  rootPc: number;
  quality: ChordQuality;
  /** pitch classes that actually sound, root first */
  pcs: number[];
  /** ascending semitones above the root that voicings use (the sounding template) */
  ivs?: number[];
  /** chord tones that are not in the scale (borrowed or chromatic chords) */
  outside?: number[];
}

export type HarmonicFunction = "tonic" | "pre" | "dominant" | "colour" | "pedal" | "chromatic";

export interface ChordSlot {
  start: Beats;
  dur: Beats;
  chord: Chord;
  /** pitch class the bass should hold (pedal point) — defaults to the chord root */
  bassPc: number;
  func?: HarmonicFunction;
  /** 0 = at rest … 1 = maximum pull toward resolution */
  tension?: number;
  /** written as an absolute chord (chromatic): transposes, never re-diatonicises */
  absolute?: boolean;
  /** stacked chord size it was built with (3 triad, 4 seventh, 5 ninth) */
  size?: number;
}

/** How freely tonal generators may leave the scale and the current chord. */
export type HarmonyBehavior = "strict" | "expressive" | "experimental";

export type ChordColour = "auto" | "triads" | "sevenths" | "ninths" | "sus" | "added" | "quartal";
