// COMPOSITION PROFILES. A profile is not a preset: it is the grammar the composer's algorithms read
// — which scales, meters and forms it reaches for, how each kind of section harmonises, what rhythm
// cells its themes are built from, how phrases develop, which accompaniment techniques and
// imitation devices it uses, which roles matter most, and which process (if any) drives the
// long-range development. Every field below changes generated notes, not just sound.

import type { PhraseForm } from "../theory/motif";
import type { HarmonyBehavior, MeterId, ScaleId } from "../theory/types";
import type { BordunType, FormId, HarmonyLanguage, ImitationKind, ProfileId, RoleId, SectionFn } from "./types";

export type Weighted<T extends string> = Partial<Record<T, number>>;

/** Rhythm cells themes are assembled from (see themes.ts). */
export type CellId =
  | "ta" | "titi" | "tikatika" | "titika" | "tikati" | "timri" | "rest"
  | "taa" | "dotted" | "syncopa" | "taaa" | "whole"
  | "dq" | "qe" | "eee" | "eq";

export type Contour = "chant" | "arch" | "wave" | "step" | "leap" | "cell";

export interface MotifGrammar {
  /** bars one statement of the motif occupies */
  bars: number;
  cells: Weighted<CellId>;
  contour: Contour;
  /** 0..1 tendency to leap (always followed by a step back) */
  leap: number;
  /** widest span of a motif in scale steps */
  range: number;
  pickup: number;
}

export type Process = "none" | "minimal" | "poly";

export interface Profile {
  id: ProfileId;
  label: string;
  description: string;
  scales: Weighted<ScaleId>;
  meters: Weighted<MeterId>;
  tempo: [number, number];
  forms: Weighted<FormId>;
  phraseBars: number;
  /** typical section length in bars (the auto form grows section count with length) */
  sectionBars: number;
  behavior: HarmonyBehavior;
  languages: Partial<Record<SectionFn, Weighted<HarmonyLanguage>>> & { default: Weighted<HarmonyLanguage> };
  /** bars per chord at medium harmonic complexity */
  harmonicRhythm: number;
  motif: MotifGrammar;
  phraseForm: PhraseForm;
  borduns: Partial<Record<SectionFn, Weighted<BordunType>>> & { default: Weighted<BordunType> };
  imitation: Partial<Record<SectionFn, Weighted<ImitationKind>>> & { default: Weighted<ImitationKind> };
  /** role priority list: the first N that fit the instruments are used */
  roles: RoleId[];
  /** instruments drawn in order for an automatic lineup */
  lineup: string[];
  /** 0..1 baseline note density */
  density: number;
  /** 0..1 share of phrases a non-essential part leaves silent */
  silence: number;
  process: Process;
  /** contrast sections move to the relative mode of the same pitch set (Orff) or a related key */
  contrastKey: "relative" | "related" | "same";
  /** multiplies instrument decay; ambient lets bars ring longer */
  decayScale: number;
  reverb: number;
  /** the loudness/intensity range the form's arc is mapped into (ambient never gets loud) */
  dynamics: [number, number];
}

const CORE_ORFF = ["orff-bass-xylo", "orff-alto-xylo", "orff-soprano-xylo", "orff-alto-metal", "orff-soprano-glock", "orff-bass-metal", "orff-alto-glock", "orff-soprano-metal"];

export const PROFILES: Record<ProfileId, Profile> = {
  traditional: {
    id: "traditional",
    label: "Traditional Orff",
    description: "Pentatonic and modal melodies over borduns, playful ostinatos, clear question-and-answer phrasing, echo, call-and-response and canon, and an ensemble that builds layer by layer.",
    scales: { majorPent: 5, minorPent: 3, rePent: 1, solPent: 0.7, hexatonic: 0.6, dorian: 0.8, mixolydian: 0.6, major: 0.5, minor: 0.4 },
    meters: { "4/4": 3, "6/8": 3, "2/4": 2, "3/4": 2 },
    tempo: [88, 126],
    forms: { rondo: 3, aba: 3, canon: 1.5, aaba: 1.5, binary: 1, variations: 0.7 },
    phraseBars: 4,
    sectionBars: 16,
    behavior: "strict",
    languages: {
      default: { bordun: 3, shifting: 1 },
      intro: { bordun: 1 },
      contrast: { shifting: 3, modal: 1, functional: 0.4 },
      development: { shifting: 2, modal: 1 },
      climax: { shifting: 2, functional: 1, bordun: 1 },
      resolution: { bordun: 1 },
      ending: { bordun: 1 },
    },
    harmonicRhythm: 1,
    motif: { bars: 1, cells: { ta: 3, titi: 3, taa: 1.4, rest: 0.6, syncopa: 0.5, tikatika: 0.6, titika: 0.4, tikati: 0.4, dotted: 0.5, qe: 2, eee: 1.5, dq: 1, eq: 1 }, contour: "chant", leap: 0.2, range: 6, pickup: 0.15 },
    phraseForm: "period",
    borduns: {
      default: { broken: 2, level: 1.5, simple: 1 },
      intro: { simple: 2, broken: 1 },
      contrast: { crossover: 2, moving: 1.5, arpeggiated: 1 },
      development: { moving: 2, crossover: 1 },
      climax: { arpeggiated: 2, level: 1 },
      ending: { simple: 1 },
    },
    imitation: {
      default: { echo: 2, none: 1, call: 1 },
      variation: { canon: 3, echo: 1 },
      contrast: { call: 3, echo: 1, parallel: 0.8 },
      climax: { canon: 1.5, parallel: 1, heterophony: 1 },
      ending: { none: 1 },
      intro: { none: 1 },
    },
    roles: ["bordun", "melody", "ostinato", "texture", "bass", "secondary", "counter", "harmony", "punctuation", "ostinato", "arpeggio", "secondary", "texture", "counter"],
    lineup: [...CORE_ORFF, "orff-alto-xylo", "wooden-tongue", "orff-soprano-xylo", "orchestral-bells", "marimba", "crotales"],
    density: 0.55,
    silence: 0.15,
    process: "none",
    contrastKey: "relative",
    decayScale: 1,
    reverb: 0.22,
    dynamics: [0.25, 0.9],
  },
  minimal: {
    id: "minimal",
    label: "Evolving Minimalism",
    description: "Interlocking ostinatos, additive and subtractive processes, discrete phase shifting and single-note mutation over very slow harmony — long gradual development in which every change is audible.",
    scales: { dorian: 2, majorPent: 2, lydian: 1.5, minor: 1, major: 1, mixolydian: 1, minorPent: 1 },
    meters: { "4/4": 4, "12/8": 1.5, "6/8": 1, "3/4": 0.5 },
    tempo: [108, 144],
    forms: { process: 5, arch: 1, through: 1 },
    phraseBars: 4,
    sectionBars: 24,
    behavior: "strict",
    languages: { default: { pedal: 2, sparse: 2, shifting: 1.5, drone: 1 } },
    harmonicRhythm: 4,
    motif: { bars: 1, cells: { titi: 3, tikatika: 2.5, titika: 1.5, tikati: 1.5, ta: 1, rest: 1, eee: 3, qe: 1 }, contour: "cell", leap: 0.1, range: 5, pickup: 0.3 },
    phraseForm: "cell",
    borduns: { default: { broken: 2, arpeggiated: 1.5, level: 1 } },
    imitation: { default: { none: 2, hocket: 1.5, canon: 1, parallel: 0.5 } },
    roles: ["ostinato", "ostinato", "bass", "harmony", "ostinato", "melody", "arpeggio", "texture", "ostinato", "counter", "punctuation", "secondary", "ostinato", "texture"],
    lineup: ["marimba", "orff-alto-xylo", "vibraphone", "marimba", "orff-soprano-xylo", "orff-bass-metal", "celesta", "kalimba", "orff-alto-metal", "orff-soprano-glock", "orchestral-bells", "steel-tongue", "orff-alto-xylo", "crotales"],
    density: 0.7,
    silence: 0.12,
    process: "minimal",
    contrastKey: "same",
    decayScale: 1,
    reverb: 0.18,
    dynamics: [0.3, 0.85],
  },
  polyrhythmic: {
    id: "polyrhythmic",
    label: "Polyrhythmic Ensemble",
    description: "Parts with different pattern lengths and Euclidean timelines (tresillo, cinquillo, the 12/8 bell) that interlock, drift and realign at planned points; colour (pitch cycle) and talea (rhythm cycle) of different lengths.",
    scales: { minorPent: 2, dorian: 2, majorPent: 1.5, mixolydian: 1, rePent: 1, phrygianDominant: 0.5 },
    meters: { "12/8": 3, "6/8": 2, "4/4": 2, "9/8": 1, "7/8": 0.7, "5/4": 0.5 },
    tempo: [96, 132],
    forms: { process: 2, rondo: 1.5, through: 1, binary: 1, arch: 1 },
    phraseBars: 4,
    sectionBars: 16,
    behavior: "strict",
    languages: { default: { pedal: 2, modal: 2, drone: 1, shifting: 1 } },
    harmonicRhythm: 2,
    motif: { bars: 1, cells: { syncopa: 2, titika: 1.5, tikati: 1.5, titi: 2, ta: 1, dotted: 1.5, rest: 1, qe: 2, eq: 2, eee: 1 }, contour: "wave", leap: 0.25, range: 6, pickup: 0.4 },
    phraseForm: "call",
    borduns: { default: { broken: 1.5, crossover: 1.5, arpeggiated: 1 } },
    imitation: { default: { hocket: 2, call: 2, none: 1.5, echo: 0.5 } },
    roles: ["ostinato", "bass", "punctuation", "ostinato", "ostinato", "melody", "harmony", "ostinato", "texture", "experimental", "counter", "arpeggio", "ostinato", "punctuation"],
    lineup: ["orff-bass-xylo", "orff-alto-xylo", "wooden-tongue", "marimba", "kalimba", "orff-soprano-xylo", "orff-alto-metal", "steel-tongue", "orff-soprano-glock", "toy-piano", "orff-bass-metal", "concert-xylo", "orff-alto-xylo", "crotales"],
    density: 0.65,
    silence: 0.22,
    process: "poly",
    contrastKey: "same",
    decayScale: 1,
    reverb: 0.18,
    dynamics: [0.3, 0.9],
  },
  ambient: {
    id: "ambient",
    label: "Ambient / Atmospheric",
    description: "Sparse mallet figures, resonant metals with long decays, generous silence, slow harmonic drift and layers that arrive and dissolve gradually.",
    scales: { lydian: 2, majorPent: 2, solPent: 1, dorian: 1.5, mixolydian: 1, minorPent: 1, hexatonic: 1 },
    meters: { "4/4": 2, "3/4": 2, "6/8": 1, "5/4": 0.5 },
    tempo: [56, 80],
    forms: { arch: 3, through: 2, aba: 1.5, variations: 0.5 },
    phraseBars: 4,
    sectionBars: 20,
    behavior: "expressive",
    languages: { default: { drone: 3, sparse: 2, pedal: 1.5, planing: 1, modal: 1 }, intro: { drone: 1 }, ending: { drone: 1 } },
    harmonicRhythm: 4,
    motif: { bars: 2, cells: { taa: 3, ta: 2, taaa: 1.5, whole: 1, titi: 0.5, rest: 2, dq: 2, qe: 0.5 }, contour: "arch", leap: 0.2, range: 5, pickup: 0.4 },
    phraseForm: "drone",
    borduns: { default: { simple: 3, moving: 1 } },
    imitation: { default: { echo: 2, none: 2, canon: 1, heterophony: 1 } },
    roles: ["bordun", "texture", "harmony", "melody", "texture", "counter", "secondary", "texture", "harmony", "experimental", "punctuation", "arpeggio", "texture", "secondary"],
    lineup: ["orff-bass-metal", "orff-alto-metal", "vibraphone", "orff-soprano-glock", "crotales", "orff-soprano-metal", "glass-mallet", "celesta", "tubular-bells", "bell", "steel-tongue", "orff-alto-glock", "orchestral-bells", "kalimba"],
    density: 0.3,
    silence: 0.45,
    process: "none",
    contrastKey: "relative",
    decayScale: 1.25,
    reverb: 0.42,
    dynamics: [0.18, 0.62],
  },
  cinematic: {
    id: "cinematic",
    label: "Cinematic Mallets",
    description: "A defined theme stated, developed and recalled; emotional functional harmony with borrowed chords and a lift at the climax; register contrast and sectional dynamics.",
    scales: { minor: 3, major: 2, dorian: 1.5, harmonicMinor: 1, lydian: 1, mixolydian: 0.6 },
    meters: { "4/4": 3, "3/4": 1.5, "6/8": 1, "12/8": 1 },
    tempo: [72, 112],
    forms: { aba: 2, arch: 2, through: 2, variations: 1.5, aaba: 1 },
    phraseBars: 4,
    sectionBars: 16,
    behavior: "expressive",
    languages: {
      default: { functional: 3, modal: 1 },
      intro: { pedal: 2, drone: 1 },
      contrast: { functional: 2, modal: 1.5 },
      development: { functional: 2, sparse: 1 },
      climax: { functional: 3 },
      ending: { pedal: 2, functional: 1 },
    },
    harmonicRhythm: 1,
    motif: { bars: 2, cells: { ta: 2, taa: 1.5, dotted: 2, titi: 2, syncopa: 0.8, tikatika: 0.4, rest: 0.5, taaa: 0.5, dq: 1.5, qe: 2, eee: 1 }, contour: "arch", leap: 0.35, range: 8, pickup: 0.35 },
    phraseForm: "theme",
    borduns: { default: { simple: 1.5, level: 1, arpeggiated: 1 } },
    imitation: { default: { parallel: 2, none: 1.5, call: 1, canon: 0.5, heterophony: 0.5 }, climax: { parallel: 2, canon: 1 } },
    roles: ["melody", "bass", "arpeggio", "harmony", "counter", "texture", "ostinato", "secondary", "punctuation", "bordun", "texture", "harmony", "arpeggio", "secondary"],
    lineup: ["marimba", "orff-bass-metal", "vibraphone", "orff-soprano-xylo", "orff-alto-metal", "orchestral-bells", "orff-bass-xylo", "celesta", "crotales", "tubular-bells", "orff-alto-xylo", "orff-soprano-metal", "marimba", "orff-soprano-glock"],
    density: 0.6,
    silence: 0.1,
    process: "none",
    contrastKey: "related",
    decayScale: 1.05,
    reverb: 0.3,
    dynamics: [0.18, 1],
  },
  experimental: {
    id: "experimental",
    label: "Experimental",
    description: "Hemitonic and symmetric scales, asymmetric meters, rotating Euclidean rhythms, pointillist hocket, nonfunctional planing and dissonance that is placed and resolved rather than scattered.",
    scales: { hirajoshi: 1.5, wholeTone: 1.5, octatonic: 1.2, inSen: 1.2, pelog: 1, kumoi: 1, phrygian: 1, lydianDominant: 1, locrian: 0.5 },
    meters: { "7/8": 3, "5/8": 2, "5/4": 2, "9/8": 1.5, "4/4": 0.7 },
    tempo: [80, 126],
    forms: { through: 3, arch: 1.5, process: 1.5, variations: 1 },
    phraseBars: 4,
    sectionBars: 16,
    behavior: "experimental",
    languages: { default: { planing: 3, chromatic: 2, drone: 1, sparse: 1 } },
    harmonicRhythm: 2,
    motif: { bars: 1, cells: { titika: 2, tikati: 2, syncopa: 2, dotted: 1.5, rest: 2, ta: 1, tikatika: 1, timri: 1, qe: 1, eq: 1.5, eee: 1 }, contour: "leap", leap: 0.6, range: 10, pickup: 0.5 },
    phraseForm: "sentence",
    borduns: { default: { moving: 2, crossover: 1.5, arpeggiated: 1 } },
    imitation: { default: { hocket: 3, imitation: 1.5, canon: 1, echo: 1, none: 1 } },
    roles: ["experimental", "ostinato", "experimental", "melody", "texture", "punctuation", "experimental", "harmony", "bass", "counter", "secondary", "arpeggio", "experimental", "texture"],
    lineup: ["synthetic-mallet", "glass-mallet", "toy-piano", "steel-tongue", "marimba", "crotales", "wooden-tongue", "kalimba", "vibraphone", "orff-alto-metal", "orff-soprano-glock", "orff-bass-xylo", "celesta", "bell"],
    density: 0.5,
    silence: 0.25,
    process: "none",
    contrastKey: "related",
    decayScale: 1,
    reverb: 0.3,
    dynamics: [0.25, 0.9],
  },
};

export const PROFILE_IDS = Object.keys(PROFILES) as ProfileId[];

export function getProfile(id: ProfileId): Profile {
  return PROFILES[id] ?? PROFILES.traditional;
}

/** Weighted entries as parallel arrays (stable key order). */
export function entries<T extends string>(w: Weighted<T>): { items: T[]; weights: number[] } {
  const items = Object.keys(w) as T[];
  return { items, weights: items.map((k) => w[k] ?? 0) };
}

export function languageWeights(p: Profile, fn: SectionFn): Weighted<HarmonyLanguage> {
  return p.languages[fn] ?? p.languages.default;
}

export function bordunWeights(p: Profile, fn: SectionFn): Weighted<BordunType> {
  return p.borduns[fn] ?? p.borduns.default;
}

export function imitationWeights(p: Profile, fn: SectionFn): Weighted<ImitationKind> {
  return p.imitation[fn] ?? p.imitation.default;
}
