import { getInstrument } from "../audio/instruments";
import type { EngineParams, MaterialId } from "../audio/types";
import { defaultArpParams, type ArpParams, type ArpPattern } from "../audio/arpeggiator";
import { defaultEffectsParams, type EffectsParams } from "../audio/effects";
import type { ArpRate } from "../audio/timing";
import { PRESET_FORMAT, PRESET_VERSION, type GlockworkPreset, type OrffPerformanceState } from "./schema";

type EngineOverrides = {
  strike?: Partial<EngineParams["strike"]>;
  bar?: Partial<EngineParams["bar"]> & { material?: MaterialId };
  tone?: Partial<EngineParams["tone"]>;
  pitch?: Partial<EngineParams["pitch"]>;
  stereo?: Partial<EngineParams["stereo"]>;
  motor?: Partial<EngineParams["motor"]>;
  fm?: Partial<EngineParams["fm"]>;
};

function buildEngine(instrumentId: string, o: EngineOverrides = {}): EngineParams {
  const d = getInstrument(instrumentId).defaults;
  return {
    instrumentId,
    strike: { ...d.strike, ...o.strike },
    bar: { ...d.bar, ...o.bar },
    tone: { ...d.tone, ...o.tone },
    pitch: { ...d.pitch, ...o.pitch },
    stereo: { ...d.stereo, ...o.stereo },
    motor: { ...d.motor, ...o.motor },
    fm: { ...d.fm, ...o.fm },
  };
}

function buildArp(o: Partial<ArpParams> = {}): ArpParams {
  return { ...defaultArpParams(), ...o };
}

type EffectsOverrides = {
  reverb?: Partial<EffectsParams["reverb"]>;
  delay?: Partial<EffectsParams["delay"]>;
  chorus?: Partial<EffectsParams["chorus"]>;
  tremolo?: Partial<EffectsParams["tremolo"]>;
  phaser?: Partial<EffectsParams["phaser"]>;
  saturation?: Partial<EffectsParams["saturation"]>;
  eq?: Partial<EffectsParams["eq"]>;
  master?: Partial<EffectsParams["master"]>;
};

function buildEffects(o: EffectsOverrides = {}): EffectsParams {
  const d = defaultEffectsParams();
  return {
    reverb: { ...d.reverb, ...o.reverb },
    delay: { ...d.delay, ...o.delay },
    chorus: { ...d.chorus, ...o.chorus },
    tremolo: { ...d.tremolo, ...o.tremolo },
    phaser: { ...d.phaser, ...o.phaser },
    saturation: { ...d.saturation, ...o.saturation },
    eq: { ...d.eq, ...o.eq },
    master: { ...d.master, ...o.master },
  };
}

interface Spec {
  name: string;
  category: "orff" | "mallet" | "ambient" | "experimental";
  instrumentId: string;
  engine?: EngineOverrides;
  arp?: Partial<ArpParams>;
  effects?: EffectsOverrides;
  orff?: Partial<OrffPerformanceState>;
  bpm?: number;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function finish(spec: Spec): GlockworkPreset {
  return {
    format: PRESET_FORMAT,
    version: PRESET_VERSION,
    // Stable and deterministic — unlike uid(), this is the same across every page load, so a
    // session persisted in localStorage (which stores a preset id) keeps resolving correctly.
    id: `factory-${slugify(spec.name)}`,
    name: spec.name,
    category: spec.category,
    engine: buildEngine(spec.instrumentId, spec.engine),
    arp: buildArp(spec.arp),
    effects: buildEffects(spec.effects),
    performance: {
      orff: {
        enabled: spec.orff?.enabled ?? false,
        root: spec.orff?.root ?? 0,
        scaleId: spec.orff?.scaleId ?? "major-pentatonic",
      },
      bpm: spec.bpm ?? 96,
      transpose: 0,
      velocity: 0.85,
    },
  };
}

const rate = (r: ArpRate): ArpRate => r;
const pattern = (p: ArpPattern): ArpPattern => p;

const SPECS: Spec[] = [
  // ---- ORFF -------------------------------------------------------------
  {
    name: "Warm Alto Xylophone",
    category: "orff",
    instrumentId: "orff-alto-xylo",
    engine: { bar: { brightness: 0.42 }, tone: { warmth: 0.45 } },
  },
  {
    name: "Classroom Soprano Xylo",
    category: "orff",
    instrumentId: "orff-soprano-xylo",
    engine: { strike: { hardness: 0.7 }, bar: { brightness: 0.72 } },
  },
  {
    name: "Deep Bass Xylophone",
    category: "orff",
    instrumentId: "orff-bass-xylo",
    engine: { bar: { decay: 0.6, bodyResonance: 0.5 } },
  },
  {
    name: "Soft Felt Metallophone",
    category: "orff",
    instrumentId: "orff-alto-metal",
    engine: { strike: { hardness: 0.25, attack: 0.2 }, bar: { brightness: 0.35, damping: 0.5 } },
  },
  {
    name: "Bright Metallophone",
    category: "orff",
    instrumentId: "orff-soprano-metal",
    engine: { strike: { hardness: 0.65 }, bar: { brightness: 0.75, resonance: 0.5 } },
  },
  {
    name: "Tiny Glockenspiel",
    category: "orff",
    instrumentId: "orff-soprano-glock",
    engine: { bar: { decay: 0.35 }, tone: { filterCutoff: 1 } },
  },
  {
    name: "Dreamy Glockenspiel",
    category: "orff",
    instrumentId: "orff-alto-glock",
    engine: { bar: { decay: 0.75, damping: 0.15 } },
    effects: { reverb: { on: true, mix: 0.42, decay: 0.6, size: 0.6 } },
  },

  // ---- MALLET -------------------------------------------------------------
  {
    name: "Concert Marimba",
    category: "mallet",
    instrumentId: "marimba",
    effects: { reverb: { on: true, mix: 0.22, size: 0.45 } },
  },
  {
    name: "Dark Marimba",
    category: "mallet",
    instrumentId: "marimba",
    engine: { strike: { hardness: 0.15 }, bar: { brightness: 0.15, decay: 0.7 }, tone: { filterCutoff: 0.35, warmth: 0.75 } },
  },
  {
    name: "Classic Vibraphone",
    category: "mallet",
    instrumentId: "vibraphone",
    engine: { motor: { on: true, speed: 0.35, depth: 0.5 } },
    effects: { reverb: { on: true, mix: 0.3, size: 0.55, decay: 0.55 } },
  },
  {
    name: "Slow Vibraphone",
    category: "mallet",
    instrumentId: "vibraphone",
    engine: { motor: { on: true, speed: 0.12, depth: 0.7 }, bar: { decay: 0.9 } },
    effects: { reverb: { on: true, mix: 0.4, size: 0.7, decay: 0.7 } },
  },
  {
    name: "Celesta",
    category: "mallet",
    instrumentId: "celesta",
    effects: { reverb: { on: true, mix: 0.35, size: 0.5 } },
  },
  {
    name: "Toy Piano",
    category: "mallet",
    instrumentId: "toy-piano",
  },
  {
    name: "Kalimba",
    category: "mallet",
    instrumentId: "kalimba",
    effects: { chorus: { on: true, mix: 0.15, rate: 0.2, depth: 0.25 } },
  },
  {
    name: "Steel Tongue",
    category: "mallet",
    instrumentId: "steel-tongue",
    effects: { reverb: { on: true, mix: 0.3, size: 0.55, decay: 0.5 } },
  },

  // ---- AMBIENT -------------------------------------------------------------
  {
    name: "Endless Metallophone",
    category: "ambient",
    instrumentId: "orff-alto-metal",
    bpm: 84,
    engine: { bar: { decay: 0.85, damping: 0.1 }, tone: { hfDamping: 0.15 } },
    effects: {
      reverb: { on: true, mix: 0.55, size: 0.85, decay: 0.85, damping: 0.25 },
      delay: { on: true, mix: 0.3, sync: true, rate: rate("1/8"), feedback: 0.45, pingPong: true },
    },
    arp: buildArpAmbient({ pattern: pattern("up-down"), rate: rate("1/16"), octaveRange: 2, gateLength: 0.9, humanize: 0.1 }),
  },
  {
    name: "Dream Bars",
    category: "ambient",
    instrumentId: "vibraphone",
    bpm: 76,
    engine: { motor: { on: true, speed: 0.18, depth: 0.6 }, bar: { decay: 0.8 } },
    effects: {
      reverb: { on: true, mix: 0.5, size: 0.8, decay: 0.8 },
      chorus: { on: true, mix: 0.25, rate: 0.15, depth: 0.35 },
    },
    arp: buildArpAmbient({ pattern: pattern("played"), rate: rate("1/8"), octaveRange: 2, letRing: true }),
  },
  {
    name: "Glass Forest",
    category: "ambient",
    instrumentId: "glass-mallet",
    bpm: 90,
    engine: { bar: { decay: 0.85, damping: 0.06 }, fm: { enabled: true, index: 0.12 } },
    effects: {
      reverb: { on: true, mix: 0.6, size: 0.9, decay: 0.9, damping: 0.15 },
      delay: { on: true, mix: 0.28, sync: true, rate: rate("1/16T") },
    },
    arp: buildArpAmbient({ pattern: pattern("random"), rate: rate("1/16"), octaveRange: 3, probability: 0.75, letRing: true }),
    orff: { enabled: true, scaleId: "lydian" },
  },
  {
    name: "Morning Bells",
    category: "ambient",
    instrumentId: "bell",
    bpm: 88,
    engine: { bar: { decay: 0.7 } },
    effects: { reverb: { on: true, mix: 0.45, size: 0.7, decay: 0.65 } },
    arp: buildArpAmbient({ pattern: pattern("up"), rate: rate("1/4"), octaveRange: 2, swing: 0.15 }),
    orff: { enabled: true, scaleId: "major-pentatonic" },
  },
  {
    name: "Floating Marimba",
    category: "ambient",
    instrumentId: "marimba",
    bpm: 80,
    engine: { bar: { decay: 0.7, brightness: 0.4 }, tone: { warmth: 0.55 } },
    effects: {
      reverb: { on: true, mix: 0.4, size: 0.65, decay: 0.6 },
      delay: { on: true, mix: 0.22, sync: true, rate: rate("1/8T"), feedback: 0.4 },
    },
    arp: buildArpAmbient({ pattern: pattern("down-up"), rate: rate("1/8"), octaveRange: 2 }),
  },
  {
    name: "Frozen Vibraphone",
    category: "ambient",
    instrumentId: "vibraphone",
    bpm: 66,
    engine: { motor: { on: true, speed: 0.08, depth: 0.8 }, bar: { decay: 0.95, damping: 0.05 }, tone: { hfDamping: 0.1 } },
    effects: { reverb: { on: true, mix: 0.65, size: 0.95, decay: 0.95, damping: 0.1 } },
    arp: buildArpAmbient({ pattern: pattern("chord"), rate: rate("1/2"), octaveRange: 1, letRing: true }),
  },
  {
    name: "Soft Metallic Rain",
    category: "ambient",
    instrumentId: "orff-soprano-glock",
    bpm: 92,
    engine: { strike: { hardness: 0.4, strikeNoise: 0.1 }, bar: { decay: 0.5 } },
    effects: {
      reverb: { on: true, mix: 0.5, size: 0.7, decay: 0.6 },
      delay: { on: true, mix: 0.3, sync: true, rate: rate("1/16"), feedback: 0.35, pingPong: true },
    },
    arp: buildArpAmbient({ pattern: pattern("random"), rate: rate("1/16"), octaveRange: 2, probability: 0.6, velocityVariation: 0.3 }),
    orff: { enabled: true, scaleId: "minor-pentatonic" },
  },

  // ---- EXPERIMENTAL -------------------------------------------------------------
  {
    name: "Broken Toy Mallet",
    category: "experimental",
    instrumentId: "toy-piano",
    engine: { bar: { inharmonicity: 0.7, material: "synthetic" as MaterialId }, tone: { filterResonance: 0.6 } },
    effects: { saturation: { on: true, amount: 0.4 }, phaser: { on: true, mix: 0.3, rate: 0.4, depth: 0.5 } },
  },
  {
    name: "Alien Kalimba",
    category: "experimental",
    instrumentId: "kalimba",
    engine: { bar: { inharmonicity: 0.6, material: "digital" as MaterialId }, fm: { enabled: true, ratio: 2.3, index: 0.4 } },
    effects: { delay: { on: true, mix: 0.35, sync: true, rate: rate("1/8T"), feedback: 0.55, pingPong: true } },
  },
  {
    name: "FM Crystal",
    category: "experimental",
    instrumentId: "glass-mallet",
    engine: { fm: { enabled: true, ratio: 5.03, index: 0.55 }, bar: { inharmonicity: 0.5 } },
    effects: { reverb: { on: true, mix: 0.4, size: 0.7, decay: 0.7 }, chorus: { on: true, mix: 0.2, rate: 0.4, depth: 0.4 } },
  },
  {
    name: "Bent Bells",
    category: "experimental",
    instrumentId: "tubular-bells",
    engine: { bar: { inharmonicity: 0.75 }, fm: { enabled: true, ratio: 1.99, index: 0.2 } },
    effects: { phaser: { on: true, mix: 0.4, rate: 0.12, depth: 0.6 }, reverb: { on: true, mix: 0.4, decay: 0.7 } },
  },
  {
    name: "Rubber Xylophone",
    category: "experimental",
    instrumentId: "concert-xylo",
    engine: { bar: { material: "synthetic" as MaterialId, damping: 0.6, decay: 0.25 }, tone: { warmth: 0.6, filterCutoff: 0.4 } },
    effects: { saturation: { on: true, amount: 0.5 } },
  },
  {
    name: "Metallic Ghosts",
    category: "experimental",
    instrumentId: "crotales",
    bpm: 100,
    engine: { bar: { inharmonicity: 0.6, decay: 0.95 }, fm: { enabled: true, ratio: 3.4, index: 0.25 } },
    effects: {
      reverb: { on: true, mix: 0.6, size: 0.9, decay: 0.9 },
      delay: { on: true, mix: 0.3, sync: true, rate: rate("1/8T"), feedback: 0.5 },
      phaser: { on: true, mix: 0.25, rate: 0.08, depth: 0.4 },
    },
    arp: buildArpAmbient({ pattern: pattern("random"), rate: rate("1/16T"), octaveRange: 2, probability: 0.7, letRing: true }),
  },
  {
    name: "Psychedelic Orff",
    category: "experimental",
    instrumentId: "orff-alto-metal",
    bpm: 112,
    engine: { bar: { inharmonicity: 0.5, resonance: 0.65 }, fm: { enabled: true, ratio: 2.5, index: 0.3 } },
    effects: {
      phaser: { on: true, mix: 0.45, rate: 0.3, depth: 0.6 },
      chorus: { on: true, mix: 0.3, rate: 0.35, depth: 0.5 },
      delay: { on: true, mix: 0.3, sync: true, rate: rate("1/16"), feedback: 0.5, pingPong: true },
    },
    arp: buildArpAmbient({ pattern: pattern("up-down"), rate: rate("1/16"), octaveRange: 3, swing: 0.3 }),
    orff: { enabled: true, scaleId: "dorian" },
  },
  {
    name: "Glitch Mallets",
    category: "experimental",
    instrumentId: "synthetic-mallet",
    bpm: 132,
    engine: { fm: { enabled: true, ratio: 1.5, index: 0.6 }, bar: { inharmonicity: 0.8 }, tone: { filterResonance: 0.7 } },
    effects: { saturation: { on: true, amount: 0.5 }, delay: { on: true, mix: 0.4, sync: true, rate: rate("1/32"), feedback: 0.6, pingPong: true } },
    arp: buildArpAmbient({ pattern: pattern("random"), rate: rate("1/32"), octaveRange: 2, probability: 0.85, velocityVariation: 0.4, humanize: 0.02 }),
  },
];

function buildArpAmbient(o: Partial<ArpParams>): Partial<ArpParams> {
  return { on: true, latch: true, velocity: 0.7, velocityVariation: 0.2, probability: 0.95, humanize: 0.06, ...o };
}

export const FACTORY_PRESETS: GlockworkPreset[] = SPECS.map(finish);
