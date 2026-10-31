import { getInstrument, INSTRUMENTS } from "../audio/instruments";
import type { EngineParams, MaterialId } from "../audio/types";
import { ARP_PATTERNS, ARP_RATES, defaultArpParams, type ArpParams, type ArpPattern } from "../audio/arpeggiator";
import { defaultEffectsParams, type EffectsParams } from "../audio/effects";
import { SCALES } from "../audio/scales";
import { clamp } from "../utils/math";
import { uid } from "../utils/math";

export const PRESET_FORMAT = "mallet-synth-preset";
export const PRESET_VERSION = 1;

export interface OrffPerformanceState {
  enabled: boolean;
  root: number;
  scaleId: string;
}

export interface PerformanceState {
  orff: OrffPerformanceState;
  bpm: number;
  transpose: number;
  velocity: number;
}

export interface GlockworkPreset {
  format: typeof PRESET_FORMAT;
  version: number;
  id: string;
  name: string;
  category: string;
  engine: EngineParams;
  arp: ArpParams;
  effects: EffectsParams;
  performance: PerformanceState;
}

function n(value: unknown, fallback: number, min = 0, max = 1): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : fallback;
}

const MATERIALS: MaterialId[] = ["wood", "rosewood", "synthetic", "metalSoft", "metalBright", "steel", "bronze", "glass", "digital"];

export function sanitizeEngine(raw: unknown, fallback: EngineParams): EngineParams {
  const r = (raw ?? {}) as Record<string, unknown>;
  const instrumentId = INSTRUMENTS.some((i) => i.id === r.instrumentId) ? (r.instrumentId as string) : fallback.instrumentId;
  const strike = (r.strike ?? {}) as Record<string, unknown>;
  const bar = (r.bar ?? {}) as Record<string, unknown>;
  const tone = (r.tone ?? {}) as Record<string, unknown>;
  const pitch = (r.pitch ?? {}) as Record<string, unknown>;
  const stereo = (r.stereo ?? {}) as Record<string, unknown>;
  const motor = (r.motor ?? {}) as Record<string, unknown>;
  const fm = (r.fm ?? {}) as Record<string, unknown>;
  return {
    instrumentId,
    strike: {
      hardness: n(strike.hardness, fallback.strike.hardness),
      attack: n(strike.attack, fallback.strike.attack),
      strikeNoise: n(strike.strikeNoise, fallback.strike.strikeNoise),
      velocitySensitivity: n(strike.velocitySensitivity, fallback.strike.velocitySensitivity),
    },
    bar: {
      material: oneOf(bar.material, MATERIALS, fallback.bar.material),
      brightness: n(bar.brightness, fallback.bar.brightness),
      damping: n(bar.damping, fallback.bar.damping),
      decay: n(bar.decay, fallback.bar.decay),
      resonance: n(bar.resonance, fallback.bar.resonance),
      inharmonicity: n(bar.inharmonicity, fallback.bar.inharmonicity),
      bodySize: n(bar.bodySize, fallback.bar.bodySize),
      bodyResonance: n(bar.bodyResonance, fallback.bar.bodyResonance),
      fundamentalLevel: n(bar.fundamentalLevel, fallback.bar.fundamentalLevel, 0, 2),
      partialAmount: n(bar.partialAmount, fallback.bar.partialAmount, 0, 2),
    },
    tone: {
      filterCutoff: n(tone.filterCutoff, fallback.tone.filterCutoff),
      filterResonance: n(tone.filterResonance, fallback.tone.filterResonance),
      hfDamping: n(tone.hfDamping, fallback.tone.hfDamping),
      warmth: n(tone.warmth, fallback.tone.warmth),
    },
    pitch: {
      octave: Math.round(n(pitch.octave, fallback.pitch.octave, -3, 3)),
      semitone: Math.round(n(pitch.semitone, fallback.pitch.semitone, -12, 12)),
      fine: Math.round(n(pitch.fine, fallback.pitch.fine, -100, 100)),
    },
    stereo: {
      width: n(stereo.width, fallback.stereo.width),
      voiceSpread: n(stereo.voiceSpread, fallback.stereo.voiceSpread),
      panRandom: n(stereo.panRandom, fallback.stereo.panRandom),
    },
    motor: {
      on: bool(motor.on, fallback.motor.on),
      speed: n(motor.speed, fallback.motor.speed),
      depth: n(motor.depth, fallback.motor.depth),
    },
    fm: {
      enabled: bool(fm.enabled, fallback.fm.enabled),
      ratio: n(fm.ratio, fallback.fm.ratio, 0.1, 12),
      index: n(fm.index, fallback.fm.index),
    },
  };
}

function sanitizeArp(raw: unknown, fallback: ArpParams): ArpParams {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    on: bool(r.on, fallback.on),
    latch: bool(r.latch, fallback.latch),
    rate: oneOf(r.rate, ARP_RATES, fallback.rate),
    pattern: oneOf<ArpPattern>(r.pattern, ARP_PATTERNS, fallback.pattern),
    octaveRange: Math.round(n(r.octaveRange, fallback.octaveRange, 1, 4)),
    gateLength: n(r.gateLength, fallback.gateLength),
    letRing: bool(r.letRing, fallback.letRing),
    swing: n(r.swing, fallback.swing),
    velocity: n(r.velocity, fallback.velocity),
    velocityVariation: n(r.velocityVariation, fallback.velocityVariation),
    probability: n(r.probability, fallback.probability),
    humanize: n(r.humanize, fallback.humanize),
    useScaleLock: bool(r.useScaleLock, fallback.useScaleLock),
  };
}

function sanitizeEffects(raw: unknown, fallback: EffectsParams): EffectsParams {
  const r = (raw ?? {}) as Record<string, unknown>;
  const reverb = (r.reverb ?? {}) as Record<string, unknown>;
  const delay = (r.delay ?? {}) as Record<string, unknown>;
  const chorus = (r.chorus ?? {}) as Record<string, unknown>;
  const tremolo = (r.tremolo ?? {}) as Record<string, unknown>;
  const phaser = (r.phaser ?? {}) as Record<string, unknown>;
  const saturation = (r.saturation ?? {}) as Record<string, unknown>;
  const eq = (r.eq ?? {}) as Record<string, unknown>;
  const master = (r.master ?? {}) as Record<string, unknown>;
  return {
    reverb: {
      on: bool(reverb.on, fallback.reverb.on),
      mix: n(reverb.mix, fallback.reverb.mix),
      size: n(reverb.size, fallback.reverb.size),
      decay: n(reverb.decay, fallback.reverb.decay),
      damping: n(reverb.damping, fallback.reverb.damping),
    },
    delay: {
      on: bool(delay.on, fallback.delay.on),
      mix: n(delay.mix, fallback.delay.mix),
      time: n(delay.time, fallback.delay.time),
      feedback: n(delay.feedback, fallback.delay.feedback),
      pingPong: bool(delay.pingPong, fallback.delay.pingPong),
      sync: bool(delay.sync, fallback.delay.sync),
      rate: oneOf(delay.rate, ARP_RATES, fallback.delay.rate),
    },
    chorus: {
      on: bool(chorus.on, fallback.chorus.on),
      mix: n(chorus.mix, fallback.chorus.mix),
      rate: n(chorus.rate, fallback.chorus.rate),
      depth: n(chorus.depth, fallback.chorus.depth),
    },
    tremolo: {
      on: bool(tremolo.on, fallback.tremolo.on),
      rate: n(tremolo.rate, fallback.tremolo.rate),
      depth: n(tremolo.depth, fallback.tremolo.depth),
      sync: bool(tremolo.sync, fallback.tremolo.sync),
      rateNote: oneOf(tremolo.rateNote, ARP_RATES, fallback.tremolo.rateNote),
    },
    phaser: {
      on: bool(phaser.on, fallback.phaser.on),
      mix: n(phaser.mix, fallback.phaser.mix),
      rate: n(phaser.rate, fallback.phaser.rate),
      depth: n(phaser.depth, fallback.phaser.depth),
    },
    saturation: {
      on: bool(saturation.on, fallback.saturation.on),
      amount: n(saturation.amount, fallback.saturation.amount),
    },
    eq: {
      low: n(eq.low, fallback.eq.low),
      mid: n(eq.mid, fallback.eq.mid),
      high: n(eq.high, fallback.eq.high),
    },
    master: {
      gain: n(master.gain, fallback.master.gain, 0, 1.5),
      limiterOn: bool(master.limiterOn, fallback.master.limiterOn),
    },
  };
}

/** Never throws. Always returns a fully valid preset, filling in defaults for anything
 * missing or malformed so a corrupted/partial JSON file can't crash the synth. */
export function sanitizePreset(raw: unknown, nameHint = "Untitled"): GlockworkPreset {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const fallbackInstrument = getInstrument("orff-alto-xylo");
  const fallbackEngine = fallbackInstrument.defaults;
  const engine = sanitizeEngine(r.engine, fallbackEngine);
  const arp = sanitizeArp(r.arp, defaultArpParams());
  const effects = sanitizeEffects(r.effects, defaultEffectsParams());
  const perf = (r.performance ?? {}) as Record<string, unknown>;
  const orff = (perf.orff ?? {}) as Record<string, unknown>;

  return {
    format: PRESET_FORMAT,
    version: typeof r.version === "number" ? r.version : PRESET_VERSION,
    id: str(r.id, uid("preset")),
    name: str(r.name, nameHint),
    category: str(r.category, "user"),
    engine,
    arp,
    effects,
    performance: {
      orff: {
        enabled: bool(orff.enabled, false),
        root: Math.round(n(orff.root, 0, 0, 11)),
        scaleId: oneOf(
          orff.scaleId,
          SCALES.map((s) => s.id),
          "major-pentatonic",
        ),
      },
      bpm: Math.round(n(perf.bpm, 96, 40, 240)),
      transpose: Math.round(n(perf.transpose, 0, -24, 24)),
      velocity: n(perf.velocity, 0.85),
    },
  };
}

export interface ImportResult {
  preset: GlockworkPreset | null;
  error: string | null;
}

export function parsePresetJSON(text: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { preset: null, error: "That file isn't valid JSON." };
  }
  if (typeof data !== "object" || data === null) {
    return { preset: null, error: "Preset JSON must be an object." };
  }
  const obj = data as Record<string, unknown>;
  if (obj.format !== PRESET_FORMAT) {
    return { preset: null, error: `Not a Glockwork preset (expected format "${PRESET_FORMAT}").` };
  }
  try {
    return { preset: sanitizePreset(obj), error: null };
  } catch {
    return { preset: null, error: "Preset JSON was malformed and could not be loaded." };
  }
}

export function presetToJSON(preset: GlockworkPreset): string {
  return JSON.stringify(preset, null, 2);
}
