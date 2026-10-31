// ENSEMBLE COMPOSITION MODEL. One Composition holds everything a piece is: the settings and seeds
// that produced it, the shared musical plan (key, meter, form, sections, phrases, harmony, themes)
// and a list of tracks whose notes are ordinary, editable events. Playback, the editor, MIDI, WAV
// and project files all read these same note arrays; nothing about the music is decided by random
// numbers during playback.

import type { EngineParams } from "../audio/types";
import type { Motif } from "../theory/motif";
import type { Beats, ChordSlot, HarmonyBehavior, MeterId, ScaleId } from "../theory/types";

export type { Beats };

export type RoleId =
  | "bass"
  | "bordun"
  | "ostinato"
  | "melody"
  | "secondary"
  | "counter"
  | "harmony"
  | "arpeggio"
  | "punctuation"
  | "texture"
  | "experimental";

export type ProfileId = "traditional" | "minimal" | "polyrhythmic" | "ambient" | "cinematic" | "experimental";

export type FormId = "rondo" | "aba" | "aaba" | "arch" | "through" | "binary" | "variations" | "process" | "canon";

export type SectionFn = "intro" | "theme" | "contrast" | "development" | "variation" | "climax" | "resolution" | "ending" | "interlude";

/** How a section's harmony works. Bordun, shifting and drone are the elemental (Orff) languages;
 *  the others build on APERTURE's progression vocabulary. */
export type HarmonyLanguage = "bordun" | "shifting" | "modal" | "functional" | "pedal" | "drone" | "sparse" | "planing" | "chromatic";

export type Cadence = "half" | "full" | "plagal" | "deceptive" | "open";

export type PhraseKind = "question" | "answer" | "statement" | "continuation" | "free";

export interface Phrase {
  startBar: number;
  bars: number;
  cadence: Cadence;
  kind: PhraseKind;
}

export type ImitationKind = "none" | "echo" | "call" | "canon" | "hocket" | "imitation" | "parallel" | "heterophony";

export type BordunType = "simple" | "broken" | "level" | "crossover" | "arpeggiated" | "moving";

/** What one track does in one section (decided before any note is written). */
export interface PartPlan {
  /** the technique that writes this part here; null = tacet */
  technique: string | null;
  /** first bar (relative to the section) the part plays — staggered entrances */
  enterBar: number;
  /** bar (relative) after which the part stops — exits before endings */
  exitBar: number;
  /** extra parameters (bordun type, cycle length, canon offset …) */
  params?: Record<string, number | string | boolean>;
}

export interface Section {
  index: number;
  /** form letter as written: "A", "B", "A′" … */
  label: string;
  /** readable function: "Introduction", "Theme", "Contrast" … */
  name: string;
  fn: SectionFn;
  startBar: number;
  bars: number;
  /** 0..1: how full, loud and active the section is */
  intensity: number;
  /** thematic material the section states (null = none, e.g. a bordun-only introduction) */
  theme: string | null;
  /** 0 = literal statement, 1 = varied repetition, 2 = development */
  variant: number;
  language: HarmonyLanguage;
  /** tonal centre and scale of the section (contrast sections may move to the relative mode) */
  key: number;
  scale: ScaleId;
  phrases: Phrase[];
  /** the track that carries the principal line here */
  carrier: string | null;
  /** imitation between the carrier and other parts: echo, call-and-response, canon (a round has
   *  several followers, each entering `offsetBars` after the previous), hocket … */
  imitation: { kind: ImitationKind; followers: string[]; offsetBars: number; interval: number };
  /** per-track plan, keyed by track id */
  parts: Record<string, PartPlan>;
}

export interface ThemeRecord {
  id: string;
  motif: Motif;
  /** bars one statement occupies */
  bars: number;
  /** how it was made: "invented", "contrast of A", "derived from A (inversion)" … */
  origin: string;
}

export interface Plan {
  profile: ProfileId;
  form: FormId;
  key: number;
  scale: ScaleId;
  custom?: number[];
  meter: MeterId;
  bpm: number;
  bars: number;
  phraseBars: number;
  behavior: HarmonyBehavior;
  sections: Section[];
  /** the one harmony timeline every part reads (absolute beats) */
  harmony: ChordSlot[];
  themes: Record<string, ThemeRecord>;
}

export interface NoteEvent {
  /** unique within its track */
  id: number;
  start: Beats;
  /** written length; for damped parts it is also the sounding length */
  dur: Beats;
  /** sounding pitch (the instrument's written-pitch transposition is applied at playback) */
  midi: number;
  /** 0..1 */
  vel: number;
  /** recurring material it belongs to ("A", "B", "A:ostinato" …) */
  motif?: string;
  /** technique that wrote it ("bordun", "echo", "canon", "cadence" …) */
  tag?: string;
}

export type DampMode = "auto" | "ring" | "damp";

export interface TrackMix {
  /** linear track gain */
  gain: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  /** shared reverb / delay send levels, 0..1 */
  reverb: number;
  delay: number;
}

export interface Track {
  id: string;
  name: string;
  instrumentId: string;
  role: RoleId;
  /** the user chose this role/instrument by hand: lineup and role assignment keep it */
  pinned: boolean;
  /** keep this track's notes verbatim when anything regenerates */
  locked: boolean;
  engine: EngineParams;
  mix: TrackMix;
  damp: DampMode;
  color: string;
  /** per-track seed and variation counter (regenerate / vary one instrument) */
  seed: number;
  variation: number;
  notes: NoteEvent[];
}

export interface ComposeControls {
  density: number;
  harmonicComplexity: number;
  rhythmicComplexity: number;
  counterpoint: number;
  motifVariation: number;
  evolution: number;
  humanize: number;
  arrangementDensity: number;
  dissonance: number;
}

export interface ComposeSettings {
  mode: "arrangement" | "endless";
  profile: ProfileId;
  key: number | "auto";
  scale: ScaleId | "auto";
  meter: MeterId | "auto";
  bpm: number | "auto";
  form: FormId | "auto";
  lengthMode: "bars" | "duration";
  bars: number;
  seconds: number;
  instruments: number;
  /** physically playable Orff/concert ranges, mallet counts and speeds, or extended electronic ranges */
  realism: "orff" | "extended";
  controls: ComposeControls;
}

export interface Locks {
  harmony: boolean;
  rhythm: boolean;
  melody: boolean;
  arrangement: boolean;
  instruments: boolean;
}

export interface Seeds {
  master: number;
  arrangement: number;
  harmony: number;
  melody: number;
  rhythm: number;
  instruments: number;
}

export interface MasterSettings {
  gain: number;
  reverbSize: number;
  reverbDecay: number;
  /** delay time in beats */
  delayBeats: number;
  delayFeedback: number;
}

export interface Composition {
  format: "glockwork-ensemble";
  version: 1;
  name: string;
  settings: ComposeSettings;
  seeds: Seeds;
  locks: Locks;
  plan: Plan;
  tracks: Track[];
  master: MasterSettings;
}

/** A note being written, before ids, dynamics and humanisation are applied. */
export interface Draft {
  start: Beats;
  dur: Beats;
  midi: number;
  /** relative accent 0..1 — the dynamics pass turns it into a velocity */
  vel: number;
  motif?: string;
  tag?: string;
  /** kept from a previous composition (a lock): timing, length and velocity pass through untouched */
  fixed?: boolean;
}
