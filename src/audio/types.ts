/** A single resonant partial in a mallet bar's modal structure. */
export interface PartialDef {
  /** Frequency ratio relative to the fundamental. 1 = fundamental. */
  ratio: number;
  /** Relative gain of this partial (0..1-ish, not normalized — instruments are hand-tuned). */
  gain: number;
  /** Relative decay-time multiplier vs. the instrument's base decay. Lower = dies out faster. */
  decay: number;
}

export type MaterialId =
  | "wood"
  | "rosewood"
  | "synthetic"
  | "metalSoft"
  | "metalBright"
  | "steel"
  | "bronze"
  | "glass"
  | "digital";

export interface FmParams {
  enabled: boolean;
  /** Modulator frequency as a ratio of the fundamental. */
  ratio: number;
  /** Modulation index 0..1, mapped internally to Hz of deviation. */
  index: number;
}

export interface StrikeParams {
  hardness: number;
  attack: number;
  strikeNoise: number;
  velocitySensitivity: number;
}

export interface BarParams {
  material: MaterialId;
  brightness: number;
  damping: number;
  decay: number;
  resonance: number;
  inharmonicity: number;
  bodySize: number;
  bodyResonance: number;
  fundamentalLevel: number;
  partialAmount: number;
}

export interface ToneParams {
  filterCutoff: number;
  filterResonance: number;
  hfDamping: number;
  warmth: number;
}

export interface PitchParams {
  octave: number;
  semitone: number;
  fine: number;
}

export interface StereoParams {
  width: number;
  voiceSpread: number;
  panRandom: number;
}

export interface MotorParams {
  on: boolean;
  speed: number;
  depth: number;
}

/** The full synthesis "patch" for the currently selected instrument. */
export interface EngineParams {
  instrumentId: string;
  strike: StrikeParams;
  bar: BarParams;
  tone: ToneParams;
  pitch: PitchParams;
  stereo: StereoParams;
  motor: MotorParams;
  fm: FmParams;
}

export interface InstrumentModel {
  id: string;
  name: string;
  category: "orff" | "mallet" | "experimental";
  description: string;
  /** Semitone offset applied on top of the played note to place the instrument in its natural register. */
  registerOffset: number;
  partials: PartialDef[];
  defaults: EngineParams;
}

export type ModDestination = "brightness" | "filter" | "reverb" | "tremolo" | "motorDepth" | "hardness";

export interface VoiceHandle {
  id: number;
  note: number;
  velocity: number;
  startedAt: number;
  sustained: boolean;
  stop: (choke: boolean) => void;
}
