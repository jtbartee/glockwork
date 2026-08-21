import type { EngineParams, InstrumentModel, PartialDef } from "./types";

function base(overrides: Partial<{
  strike: Partial<EngineParams["strike"]>;
  bar: Partial<EngineParams["bar"]>;
  tone: Partial<EngineParams["tone"]>;
  pitch: Partial<EngineParams["pitch"]>;
  stereo: Partial<EngineParams["stereo"]>;
  motor: Partial<EngineParams["motor"]>;
  fm: Partial<EngineParams["fm"]>;
}>, instrumentId: string): EngineParams {
  return {
    instrumentId,
    strike: {
      hardness: 0.5,
      attack: 0.4,
      strikeNoise: 0.25,
      velocitySensitivity: 0.7,
      ...overrides.strike,
    },
    bar: {
      material: "wood",
      brightness: 0.5,
      damping: 0.4,
      decay: 0.45,
      resonance: 0.3,
      inharmonicity: 0.15,
      bodySize: 0.4,
      bodyResonance: 0.25,
      fundamentalLevel: 0.85,
      partialAmount: 0.6,
      ...overrides.bar,
    },
    tone: {
      filterCutoff: 0.75,
      filterResonance: 0.15,
      hfDamping: 0.3,
      warmth: 0.3,
      ...overrides.tone,
    },
    pitch: { octave: 0, semitone: 0, fine: 0, ...overrides.pitch },
    stereo: { width: 0.4, voiceSpread: 0.3, panRandom: 0.15, ...overrides.stereo },
    motor: { on: false, speed: 0.35, depth: 0.5, ...overrides.motor },
    fm: { enabled: false, ratio: 3.01, index: 0.2, ...overrides.fm },
  };
}

// Partial tables are hand-tuned per instrument family rather than derived from one
// generic "bar" model, so each instrument has a genuinely distinct modal fingerprint.
const woodBarPartials: PartialDef[] = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 2.76, gain: 0.42, decay: 0.5 },
  { ratio: 5.4, gain: 0.22, decay: 0.3 },
  { ratio: 8.93, gain: 0.11, decay: 0.18 },
  { ratio: 13.3, gain: 0.05, decay: 0.1 },
];

const metallophonePartials: PartialDef[] = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 3.0, gain: 0.3, decay: 0.65 },
  { ratio: 4.2, gain: 0.38, decay: 0.75 },
  { ratio: 6.3, gain: 0.16, decay: 0.45 },
  { ratio: 9.0, gain: 0.08, decay: 0.3 },
];

const glockenPartials: PartialDef[] = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 3.9, gain: 0.55, decay: 0.85 },
  { ratio: 9.2, gain: 0.32, decay: 0.6 },
  { ratio: 16.5, gain: 0.16, decay: 0.4 },
  { ratio: 25.0, gain: 0.07, decay: 0.25 },
];

const marimbaPartials: PartialDef[] = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 3.93, gain: 0.5, decay: 0.55 },
  { ratio: 6.1, gain: 0.14, decay: 0.3 },
  { ratio: 9.4, gain: 0.06, decay: 0.18 },
];

const vibraphonePartials: PartialDef[] = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 4.0, gain: 0.46, decay: 0.9 },
  { ratio: 10.0, gain: 0.14, decay: 0.55 },
  { ratio: 16.0, gain: 0.06, decay: 0.35 },
];

const crotalesPartials: PartialDef[] = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 2.5, gain: 0.5, decay: 0.95 },
  { ratio: 3.9, gain: 0.4, decay: 0.9 },
  { ratio: 5.7, gain: 0.25, decay: 0.8 },
  { ratio: 8.2, gain: 0.15, decay: 0.7 },
];

const tubularBellPartials: PartialDef[] = [
  { ratio: 1, gain: 0.85, decay: 1 },
  { ratio: 1.005, gain: 0.85, decay: 1 }, // detuned twin -> slow beating
  { ratio: 2.0, gain: 0.5, decay: 0.9 },
  { ratio: 2.4, gain: 0.45, decay: 0.85 },
  { ratio: 3.01, gain: 0.35, decay: 0.8 },
  { ratio: 4.2, gain: 0.2, decay: 0.65 },
];

const celestaPartials: PartialDef[] = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 2.0, gain: 0.28, decay: 0.6 },
  { ratio: 3.0, gain: 0.14, decay: 0.4 },
  { ratio: 4.8, gain: 0.06, decay: 0.25 },
];

const kalimbaPartials: PartialDef[] = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 2.0, gain: 0.32, decay: 0.4 },
  { ratio: 3.0, gain: 0.18, decay: 0.25 },
  { ratio: 4.6, gain: 0.08, decay: 0.15 },
];

const toyPianoPartials: PartialDef[] = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 2.05, gain: 0.4, decay: 0.5 },
  { ratio: 3.9, gain: 0.3, decay: 0.35 },
  { ratio: 5.5, gain: 0.16, decay: 0.22 },
];

const steelTonguePartials: PartialDef[] = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 2.0, gain: 0.35, decay: 0.75 },
  { ratio: 3.0, gain: 0.22, decay: 0.6 },
  { ratio: 4.16, gain: 0.13, decay: 0.45 },
  { ratio: 5.43, gain: 0.07, decay: 0.3 },
];

const woodTonguePartials: PartialDef[] = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 2.0, gain: 0.22, decay: 0.45 },
  { ratio: 3.0, gain: 0.1, decay: 0.28 },
  { ratio: 4.16, gain: 0.04, decay: 0.16 },
];

const bellPartials: PartialDef[] = [
  { ratio: 0.5, gain: 0.55, decay: 1 },
  { ratio: 1, gain: 1, decay: 0.9 },
  { ratio: 1.2, gain: 0.5, decay: 0.8 },
  { ratio: 1.5, gain: 0.4, decay: 0.75 },
  { ratio: 2.0, gain: 0.35, decay: 0.7 },
  { ratio: 2.66, gain: 0.2, decay: 0.55 },
];

const glassPartials: PartialDef[] = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 3.3, gain: 0.4, decay: 0.9 },
  { ratio: 6.8, gain: 0.28, decay: 0.85 },
  { ratio: 11.2, gain: 0.18, decay: 0.75 },
  { ratio: 17.0, gain: 0.1, decay: 0.65 },
];

const syntheticPartials: PartialDef[] = [
  { ratio: 1, gain: 1, decay: 1 },
  { ratio: 1.41, gain: 0.5, decay: 0.7 },
  { ratio: 2.83, gain: 0.35, decay: 0.55 },
  { ratio: 4.24, gain: 0.22, decay: 0.4 },
  { ratio: 6.0, gain: 0.12, decay: 0.3 },
];

export const INSTRUMENTS: InstrumentModel[] = [
  {
    id: "orff-soprano-xylo",
    name: "Soprano Xylophone",
    category: "orff",
    description: "Small rosewood bars, bright and fast — the classroom lead voice.",
    registerOffset: 12,
    partials: woodBarPartials,
    defaults: base({
      strike: { hardness: 0.65, attack: 0.6, strikeNoise: 0.3 },
      bar: { material: "rosewood", brightness: 0.7, damping: 0.55, decay: 0.25, bodySize: 0.2, bodyResonance: 0.15 },
      tone: { filterCutoff: 0.85, hfDamping: 0.25 },
    }, "orff-soprano-xylo"),
  },
  {
    id: "orff-alto-xylo",
    name: "Alto Xylophone",
    category: "orff",
    description: "Mid-register wooden bars with a round, woody knock.",
    registerOffset: 0,
    partials: woodBarPartials,
    defaults: base({
      strike: { hardness: 0.55, attack: 0.5, strikeNoise: 0.25 },
      bar: { material: "wood", brightness: 0.55, damping: 0.45, decay: 0.32, bodySize: 0.35, bodyResonance: 0.2 },
    }, "orff-alto-xylo"),
  },
  {
    id: "orff-bass-xylo",
    name: "Bass Xylophone",
    category: "orff",
    description: "Large low bars, warm and thuddy with a long-ish woody tail.",
    registerOffset: -12,
    partials: woodBarPartials,
    defaults: base({
      strike: { hardness: 0.4, attack: 0.4, strikeNoise: 0.2 },
      bar: { material: "wood", brightness: 0.35, damping: 0.3, decay: 0.5, bodySize: 0.75, bodyResonance: 0.4 },
      tone: { filterCutoff: 0.55, warmth: 0.55 },
    }, "orff-bass-xylo"),
  },
  {
    id: "orff-soprano-metal",
    name: "Soprano Metallophone",
    category: "orff",
    description: "Bright metal bars over small resonator boxes.",
    registerOffset: 12,
    partials: metallophonePartials,
    defaults: base({
      strike: { hardness: 0.5, attack: 0.4, strikeNoise: 0.15 },
      bar: { material: "metalSoft", brightness: 0.6, damping: 0.35, decay: 0.55, resonance: 0.4, bodySize: 0.3, bodyResonance: 0.35 },
    }, "orff-soprano-metal"),
  },
  {
    id: "orff-alto-metal",
    name: "Alto Metallophone",
    category: "orff",
    description: "The Orff ensemble workhorse — warm sustaining metal bars.",
    registerOffset: 0,
    partials: metallophonePartials,
    defaults: base({
      strike: { hardness: 0.45, attack: 0.35, strikeNoise: 0.15 },
      bar: { material: "metalSoft", brightness: 0.5, damping: 0.3, decay: 0.6, resonance: 0.42, bodySize: 0.4, bodyResonance: 0.4 },
    }, "orff-alto-metal"),
  },
  {
    id: "orff-bass-metal",
    name: "Bass Metallophone",
    category: "orff",
    description: "Deep sustaining metal bars with a slow, resonant swell.",
    registerOffset: -12,
    partials: metallophonePartials,
    defaults: base({
      strike: { hardness: 0.35, attack: 0.3, strikeNoise: 0.12 },
      bar: { material: "metalSoft", brightness: 0.35, damping: 0.2, decay: 0.78, resonance: 0.5, bodySize: 0.8, bodyResonance: 0.5 },
      tone: { warmth: 0.5 },
    }, "orff-bass-metal"),
  },
  {
    id: "orff-soprano-glock",
    name: "Soprano Glockenspiel",
    category: "orff",
    description: "Tiny unresonated steel bars — pure high sparkle.",
    registerOffset: 24,
    partials: glockenPartials,
    defaults: base({
      strike: { hardness: 0.8, attack: 0.75, strikeNoise: 0.2 },
      bar: { material: "metalBright", brightness: 0.85, damping: 0.35, decay: 0.6, resonance: 0.2, bodySize: 0.1, bodyResonance: 0.05 },
      tone: { filterCutoff: 0.95, hfDamping: 0.15 },
    }, "orff-soprano-glock"),
  },
  {
    id: "orff-alto-glock",
    name: "Alto Glockenspiel",
    category: "orff",
    description: "One octave down from soprano glock — still glassy and bright.",
    registerOffset: 12,
    partials: glockenPartials,
    defaults: base({
      strike: { hardness: 0.72, attack: 0.7, strikeNoise: 0.18 },
      bar: { material: "metalBright", brightness: 0.78, damping: 0.3, decay: 0.65, resonance: 0.22, bodySize: 0.15, bodyResonance: 0.08 },
      tone: { filterCutoff: 0.9, hfDamping: 0.18 },
    }, "orff-alto-glock"),
  },
  {
    id: "concert-xylo",
    name: "Concert Xylophone",
    category: "mallet",
    description: "Full-size orchestral xylophone with tube resonators beneath the bars.",
    registerOffset: 0,
    partials: woodBarPartials,
    defaults: base({
      strike: { hardness: 0.6, attack: 0.55, strikeNoise: 0.28 },
      bar: { material: "rosewood", brightness: 0.6, damping: 0.35, decay: 0.4, resonance: 0.35, bodySize: 0.5, bodyResonance: 0.4 },
    }, "concert-xylo"),
  },
  {
    id: "marimba",
    name: "Marimba",
    category: "mallet",
    description: "Deep rosewood bars and long tube resonators — warm, fundamental-rich.",
    registerOffset: -12,
    partials: marimbaPartials,
    defaults: base({
      strike: { hardness: 0.3, attack: 0.25, strikeNoise: 0.15 },
      bar: { material: "rosewood", brightness: 0.3, damping: 0.25, decay: 0.55, resonance: 0.55, bodySize: 0.8, bodyResonance: 0.65, fundamentalLevel: 0.95, partialAmount: 0.4 },
      tone: { warmth: 0.6, filterCutoff: 0.5 },
    }, "marimba"),
  },
  {
    id: "vibraphone",
    name: "Vibraphone",
    category: "mallet",
    description: "Metal bars, tube resonators, and a motor-driven vibrato fan.",
    registerOffset: -5,
    partials: vibraphonePartials,
    defaults: base({
      strike: { hardness: 0.4, attack: 0.35, strikeNoise: 0.12 },
      bar: { material: "metalSoft", brightness: 0.55, damping: 0.15, decay: 0.85, resonance: 0.6, bodySize: 0.6, bodyResonance: 0.55 },
      tone: { warmth: 0.4 },
      motor: { on: true, speed: 0.35, depth: 0.55 },
    }, "vibraphone"),
  },
  {
    id: "orchestral-bells",
    name: "Glockenspiel / Orchestral Bells",
    category: "mallet",
    description: "The concert-hall glockenspiel — bright steel bars, no resonators.",
    registerOffset: 12,
    partials: glockenPartials,
    defaults: base({
      strike: { hardness: 0.7, attack: 0.65, strikeNoise: 0.2 },
      bar: { material: "metalBright", brightness: 0.75, damping: 0.3, decay: 0.62, bodySize: 0.15 },
      tone: { filterCutoff: 0.9 },
    }, "orchestral-bells"),
  },
  {
    id: "crotales",
    name: "Crotales",
    category: "mallet",
    description: "Tuned bronze antique cymbals — precise pitch, extremely long ring.",
    registerOffset: 24,
    partials: crotalesPartials,
    defaults: base({
      strike: { hardness: 0.85, attack: 0.8, strikeNoise: 0.1 },
      bar: { material: "bronze", brightness: 0.8, damping: 0.08, decay: 0.9, resonance: 0.3, inharmonicity: 0.3, bodySize: 0.1 },
      tone: { filterCutoff: 0.95, hfDamping: 0.08 },
    }, "crotales"),
  },
  {
    id: "tubular-bells",
    name: "Tubular Bells",
    category: "mallet",
    description: "Long suspended metal tubes — huge, slow, beating bell tone.",
    registerOffset: -12,
    partials: tubularBellPartials,
    defaults: base({
      strike: { hardness: 0.55, attack: 0.3, strikeNoise: 0.2, velocitySensitivity: 0.6 },
      bar: { material: "bronze", brightness: 0.5, damping: 0.05, decay: 0.95, resonance: 0.5, inharmonicity: 0.4, bodySize: 0.9, bodyResonance: 0.6 },
      tone: { warmth: 0.35 },
    }, "tubular-bells"),
  },
  {
    id: "celesta",
    name: "Celesta",
    category: "mallet",
    description: "Felt hammers on steel bars over wooden resonance boxes — ethereal.",
    registerOffset: 0,
    partials: celestaPartials,
    defaults: base({
      strike: { hardness: 0.25, attack: 0.2, strikeNoise: 0.08 },
      bar: { material: "metalSoft", brightness: 0.4, damping: 0.35, decay: 0.5, resonance: 0.25, bodySize: 0.4, bodyResonance: 0.3 },
      tone: { warmth: 0.55, filterCutoff: 0.65 },
    }, "celesta"),
  },
  {
    id: "kalimba",
    name: "Kalimba",
    category: "mallet",
    description: "Plucked metal tines — thumb-piano character with a buzzy fundamental.",
    registerOffset: 0,
    partials: kalimbaPartials,
    defaults: base({
      strike: { hardness: 0.3, attack: 0.15, strikeNoise: 0.1 },
      bar: { material: "metalSoft", brightness: 0.35, damping: 0.4, decay: 0.4, resonance: 0.2, bodySize: 0.2, bodyResonance: 0.15, partialAmount: 0.4 },
      tone: { warmth: 0.4 },
    }, "kalimba"),
  },
  {
    id: "toy-piano",
    name: "Toy Piano",
    category: "mallet",
    description: "Small hammers on steel rods — bright, slightly out-of-tune clangor.",
    registerOffset: 0,
    partials: toyPianoPartials,
    defaults: base({
      strike: { hardness: 0.75, attack: 0.6, strikeNoise: 0.22 },
      bar: { material: "metalBright", brightness: 0.65, damping: 0.4, decay: 0.3, inharmonicity: 0.35, bodySize: 0.15 },
    }, "toy-piano"),
  },
  {
    id: "steel-tongue",
    name: "Steel Tongue Drum",
    category: "mallet",
    description: "Hollow steel shell, tongue-cut resonant zones — warm metallic sustain.",
    registerOffset: -5,
    partials: steelTonguePartials,
    defaults: base({
      strike: { hardness: 0.35, attack: 0.3, strikeNoise: 0.18 },
      bar: { material: "steel", brightness: 0.45, damping: 0.25, decay: 0.65, resonance: 0.45, bodySize: 0.6, bodyResonance: 0.5 },
      tone: { warmth: 0.45 },
    }, "steel-tongue"),
  },
  {
    id: "wooden-tongue",
    name: "Wooden Tongue Drum",
    category: "mallet",
    description: "Carved wooden slit drum — soft, thuddy, and short-voiced.",
    registerOffset: -5,
    partials: woodTonguePartials,
    defaults: base({
      strike: { hardness: 0.2, attack: 0.2, strikeNoise: 0.3 },
      bar: { material: "wood", brightness: 0.25, damping: 0.5, decay: 0.35, bodySize: 0.55, bodyResonance: 0.35 },
      tone: { warmth: 0.6, filterCutoff: 0.45 },
    }, "wooden-tongue"),
  },
  {
    id: "bell",
    name: "Bell",
    category: "mallet",
    description: "Classic inharmonic handbell partial structure with a long hum tone.",
    registerOffset: -5,
    partials: bellPartials,
    defaults: base({
      strike: { hardness: 0.6, attack: 0.4, strikeNoise: 0.15 },
      bar: { material: "bronze", brightness: 0.55, damping: 0.1, decay: 0.85, resonance: 0.5, inharmonicity: 0.5, bodySize: 0.7, bodyResonance: 0.55 },
    }, "bell"),
  },
  {
    id: "glass-mallet",
    name: "Glass Mallet",
    category: "experimental",
    description: "Struck glass with FM-enhanced shimmer — bright, inharmonic, otherworldly.",
    registerOffset: 0,
    partials: glassPartials,
    defaults: base({
      strike: { hardness: 0.9, attack: 0.85, strikeNoise: 0.15 },
      bar: { material: "glass", brightness: 0.85, damping: 0.1, decay: 0.75, inharmonicity: 0.4, resonance: 0.35 },
      tone: { filterCutoff: 0.95, hfDamping: 0.1 },
      fm: { enabled: true, ratio: 3.98, index: 0.15 },
    }, "glass-mallet"),
  },
  {
    id: "synthetic-mallet",
    name: "Synthetic Mallet",
    category: "experimental",
    description: "Fully electronic mallet voice — stretched partials, FM grit, filter bite.",
    registerOffset: 0,
    partials: syntheticPartials,
    defaults: base({
      strike: { hardness: 0.65, attack: 0.5, strikeNoise: 0.35 },
      bar: { material: "digital", brightness: 0.6, damping: 0.3, decay: 0.55, inharmonicity: 0.6, resonance: 0.45 },
      tone: { filterCutoff: 0.7, filterResonance: 0.4 },
      fm: { enabled: true, ratio: 1.5, index: 0.35 },
    }, "synthetic-mallet"),
  },
];

export function getInstrument(id: string): InstrumentModel {
  return INSTRUMENTS.find((i) => i.id === id) ?? INSTRUMENTS[1];
}

export const MATERIAL_LABELS: Record<string, string> = {
  wood: "Wood",
  rosewood: "Rosewood",
  synthetic: "Synthetic",
  metalSoft: "Soft Metal",
  metalBright: "Bright Metal",
  steel: "Steel",
  bronze: "Bronze",
  glass: "Glass",
  digital: "Digital",
};
