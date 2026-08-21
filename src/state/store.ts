import { AudioEngine } from "../audio/engine";
import { Arpeggiator, defaultArpParams, type ArpParams } from "../audio/arpeggiator";
import { defaultEffectsParams, type EffectsParams } from "../audio/effects";
import type { EngineParams, ModDestination } from "../audio/types";
import { getInstrument, INSTRUMENTS } from "../audio/instruments";
import { SCALES, getScale, quantizeToScale } from "../audio/scales";
import { MidiManager, type MidiChannelFilter, type MidiDeviceInfo } from "../midi/midiManager";
import { PresetManager } from "../presets/presetManager";
import { sanitizePreset, type GlockworkPreset, type OrffPerformanceState, type PerformanceState } from "../presets/schema";
import { Emitter } from "../utils/events";
import { clamp, uid } from "../utils/math";
import { COMPUTER_KEY_MAP, OCTAVE_DOWN_KEY, OCTAVE_UP_KEY } from "../utils/notes";

const SESSION_KEY = "glockwork.session.v1";

export interface MidiCCMapping {
  path: string;
  min: number;
  max: number;
  label: string;
}

interface MidiUiState {
  supported: boolean;
  devices: MidiDeviceInfo[];
  selectedInputId: string | "any";
  channelFilter: MidiChannelFilter;
  modDestination: ModDestination;
  learnActive: boolean;
  learnArmed: MidiCCMapping | null;
  ccMappings: Record<number, MidiCCMapping>;
}

interface TransportState {
  bpm: number;
  clockSource: "internal" | "midi";
  clockRunning: boolean;
}

interface StoreEvents {
  change: void;
  "param-changed": { path: string };
  "preset-loaded": GlockworkPreset;
  "presets-changed": void;
  "midi-changed": void;
  "midi-activity": void;
  "key-visual": { note: number; on: boolean; velocity: number; source: "keyboard" | "mouse" | "midi" };
  "voice-visual": { note: number; on: boolean };
  "arp-step": { note: number; velocity: number };
  [key: string]: unknown;
}

const DEFAULT_INSTRUMENT_ID = "orff-alto-xylo";

/** The single coordinating object the UI talks to. Owns the audio engine, arpeggiator, MIDI
 * manager and preset manager, and exposes a generic dot-path setter so every knob/switch in
 * the UI (and MIDI Learn) can go through one mechanism. */
export class AppStore {
  readonly events = new Emitter<StoreEvents>();
  readonly engine: AudioEngine;
  readonly arp: Arpeggiator;
  readonly midi: MidiManager;
  readonly presets: PresetManager;

  private orffState: OrffPerformanceState = { enabled: false, root: 0, scaleId: "major-pentatonic" };
  private transport: TransportState = { bpm: 96, clockSource: "internal", clockRunning: true };
  private performanceState = { transpose: 0, velocity: 0.85 };
  private effectsParams: EffectsParams = defaultEffectsParams();

  private currentPresetId: string | null = null;
  private currentPresetName = "Init Xylophone";
  private dirty = false;

  private directNoteMap = new Map<number, number>();
  private pressedComputerKeys = new Set<string>();
  private computerOctaveShift = 0;
  private preRandomSnapshot: { engine: EngineParams; effects: EffectsParams; arp: ArpParams } | null = null;

  private midiUi: MidiUiState = {
    supported: false,
    devices: [],
    selectedInputId: "any",
    channelFilter: "omni",
    modDestination: "brightness",
    learnActive: false,
    learnArmed: null,
    ccMappings: {},
  };

  constructor() {
    this.engine = new AudioEngine(() => this.transport.bpm);
    this.arp = new Arpeggiator(this.engine.ctx, this.engine, {
      getBpm: () => this.transport.bpm,
      getOrffScale: () => this.orffState,
      getClockRunning: () => (this.transport.clockSource === "midi" ? this.transport.clockRunning : true),
    });
    this.midi = new MidiManager({
      onNoteOn: (note, vel) => this.noteOn(note, vel, "midi"),
      onNoteOff: (note) => this.noteOff(note, "midi"),
      onSustain: (on) => this.engine.setSustain(on),
      onPitchBend: (v) => this.engine.setPitchBend(v),
      onModWheel: (v) => this.engine.setModWheel(v),
      onCC: (cc, v) => this.handleMidiCC(cc, v),
      onClockTick: (bpm) => {
        if (this.transport.clockSource === "midi" && bpm !== null) this.setBpm(bpm);
      },
      onClockStart: () => {
        this.transport.clockRunning = true;
        this.arp.clearHeld();
      },
      onClockStop: () => {
        this.transport.clockRunning = false;
      },
      onClockContinue: () => {
        this.transport.clockRunning = true;
      },
    });
    this.midi.events.on("devices-changed", (devices) => {
      this.midiUi.devices = devices;
      this.events.emit("midi-changed", undefined);
      this.events.emit("change", undefined);
    });
    this.midi.events.on("activity", () => this.events.emit("midi-activity", undefined));

    this.engine.events.on("voice-start", ({ note }) => this.events.emit("voice-visual", { note, on: true }));
    this.engine.events.on("voice-end", ({ note }) => this.events.emit("voice-visual", { note, on: false }));
    this.arp.events.on("step", ({ note, velocity }) => this.events.emit("arp-step", { note, velocity }));

    this.presets = new PresetManager();

    this.engine.setParams(getInstrument(DEFAULT_INSTRUMENT_ID).defaults);
    this.engine.setEffectsParams(this.effectsParams);
    this.arp.setParams(defaultArpParams());

    this.restoreSession();
    this.setupComputerKeyboard();
    this.setupGestureResume();
  }

  async init(): Promise<void> {
    this.midiUi.supported = await this.midi.init();
    this.events.emit("midi-changed", undefined);
    this.events.emit("change", undefined);
  }

  // ---- generic getters ----------------------------------------------------

  getEngineParams(): EngineParams {
    return this.engine.getParams();
  }
  getEffectsParams(): EffectsParams {
    return this.effectsParams;
  }
  getArpParams(): ArpParams {
    return this.arp.getParams();
  }
  getOrffState(): OrffPerformanceState {
    return this.orffState;
  }
  getTransport(): TransportState {
    return this.transport;
  }
  getPerformanceState(): { transpose: number; velocity: number } {
    return this.performanceState;
  }
  getMidiUiState(): MidiUiState {
    return this.midiUi;
  }
  getCurrentPresetMeta(): { id: string | null; name: string; dirty: boolean } {
    return { id: this.currentPresetId, name: this.currentPresetName, dirty: this.dirty };
  }
  getComputerOctaveShift(): number {
    return this.computerOctaveShift;
  }

  shiftComputerOctave(dir: 1 | -1): void {
    this.computerOctaveShift = clamp(this.computerOctaveShift + dir, -3, 3);
    this.events.emit("change", undefined);
  }

  // ---- generic dot-path param setter (also used by MIDI Learn) -----------

  setByPath(path: string, value: number | boolean | string): void {
    const [root, ...rest] = path.split(".");
    if (root === "engine") {
      const next = structuredCloneSafe(this.engine.getParams());
      setDeep(next, rest, value);
      this.engine.setParams(next);
    } else if (root === "effects") {
      const next = structuredCloneSafe(this.effectsParams);
      setDeep(next, rest, value);
      this.effectsParams = next;
      this.engine.setEffectsParams(next);
    } else if (root === "arp") {
      const next = structuredCloneSafe(this.arp.getParams());
      setDeep(next, rest, value);
      this.arp.setParams(next);
    } else if (root === "orff") {
      const next = structuredCloneSafe(this.orffState);
      setDeep(next, rest, value);
      this.orffState = next;
    } else if (root === "performance") {
      const next = structuredCloneSafe(this.performanceState);
      setDeep(next, rest, value);
      this.performanceState = next;
    } else if (root === "transport" && rest[0] === "bpm" && typeof value === "number") {
      this.transport.bpm = clamp(value, 40, 240);
    } else {
      return;
    }
    this.dirty = true;
    this.events.emit("param-changed", { path });
    this.events.emit("change", undefined);
    this.persistSession();
  }

  getByPath(path: string): unknown {
    const [root, ...rest] = path.split(".");
    const source =
      root === "engine"
        ? this.engine.getParams()
        : root === "effects"
          ? this.effectsParams
          : root === "arp"
            ? this.arp.getParams()
            : root === "orff"
              ? this.orffState
              : root === "performance"
                ? this.performanceState
                : root === "transport"
                  ? this.transport
                  : null;
    if (!source) return undefined;
    return getDeep(source, rest);
  }

  // ---- instrument / orff --------------------------------------------------

  setInstrument(id: string): void {
    const instrument = getInstrument(id);
    this.engine.setParams(instrument.defaults);
    this.dirty = true;
    this.events.emit("change", undefined);
    this.persistSession();
  }

  setOrffEnabled(enabled: boolean): void {
    this.setByPath("orff.enabled", enabled);
  }
  setOrffRoot(root: number): void {
    this.setByPath("orff.root", clamp(root, 0, 11));
  }
  setOrffScale(scaleId: string): void {
    this.setByPath("orff.scaleId", scaleId);
  }

  setBpm(bpm: number): void {
    this.transport.bpm = clamp(bpm, 40, 240);
    this.events.emit("change", undefined);
    this.persistSession();
  }

  setClockSource(source: "internal" | "midi"): void {
    this.transport.clockSource = source;
    this.transport.clockRunning = true;
    this.events.emit("change", undefined);
  }

  // ---- note routing ---------------------------------------------------------

  noteOn(rawNote: number, velocity01: number, source: "keyboard" | "mouse" | "midi"): void {
    const note = clamp(rawNote + this.performanceState.transpose, 0, 127);
    this.arp.noteHeld(note, true);
    this.events.emit("key-visual", { note, on: true, velocity: velocity01, source });
    if (!this.arp.getParams().on) {
      const playNote = this.orffState.enabled ? quantizeToScale(note, this.orffState.root, getScale(this.orffState.scaleId)) : note;
      this.engine.noteOn(playNote, velocity01, false);
      this.directNoteMap.set(note, playNote);
    }
  }

  noteOff(rawNote: number, source: "keyboard" | "mouse" | "midi"): void {
    const note = clamp(rawNote + this.performanceState.transpose, 0, 127);
    this.arp.noteHeld(note, false);
    this.events.emit("key-visual", { note, on: false, velocity: 0, source });
    if (!this.arp.getParams().on) {
      const playNote = this.directNoteMap.get(note) ?? note;
      this.directNoteMap.delete(note);
      this.engine.noteOff(playNote);
    }
  }

  panic(): void {
    this.engine.panic();
    this.arp.clearHeld();
  }

  // ---- computer keyboard ----------------------------------------------------

  private setupComputerKeyboard(): void {
    window.addEventListener("keydown", (e) => {
      if (e.repeat) return;
      if (isTypingTarget(e.target)) return;
      if (e.code === OCTAVE_DOWN_KEY) {
        this.shiftComputerOctave(-1);
        return;
      }
      if (e.code === OCTAVE_UP_KEY) {
        this.shiftComputerOctave(1);
        return;
      }
      const semitone = COMPUTER_KEY_MAP[e.code];
      if (semitone === undefined) return;
      e.preventDefault();
      this.pressedComputerKeys.add(e.code);
      const note = 60 + this.computerOctaveShift * 12 + semitone;
      this.noteOn(note, this.performanceState.velocity, "keyboard");
    });
    window.addEventListener("keyup", (e) => {
      const semitone = COMPUTER_KEY_MAP[e.code];
      if (semitone === undefined) return;
      if (!this.pressedComputerKeys.delete(e.code)) return;
      const note = 60 + this.computerOctaveShift * 12 + semitone;
      this.noteOff(note, "keyboard");
    });
    window.addEventListener("blur", () => {
      for (const code of this.pressedComputerKeys) {
        const semitone = COMPUTER_KEY_MAP[code];
        if (semitone !== undefined) this.noteOff(60 + this.computerOctaveShift * 12 + semitone, "keyboard");
      }
      this.pressedComputerKeys.clear();
    });
  }

  private setupGestureResume(): void {
    const resume = () => {
      void this.engine.resume();
    };
    window.addEventListener("pointerdown", resume, { once: true });
    window.addEventListener("keydown", resume, { once: true });
  }

  // ---- MIDI UI --------------------------------------------------------------

  setMidiInput(id: string | "any"): void {
    this.midi.setSelectedInput(id);
    this.midiUi.selectedInputId = id;
    this.events.emit("midi-changed", undefined);
    this.events.emit("change", undefined);
  }

  setMidiChannel(filter: MidiChannelFilter): void {
    this.midi.setChannelFilter(filter);
    this.midiUi.channelFilter = filter;
    this.events.emit("midi-changed", undefined);
    this.events.emit("change", undefined);
  }

  setModDestination(dest: ModDestination): void {
    this.midiUi.modDestination = dest;
    this.engine.setModDestination(dest);
    this.events.emit("midi-changed", undefined);
    this.events.emit("change", undefined);
  }

  beginMidiLearn(path: string, min: number, max: number, label: string): void {
    this.midiUi.learnActive = true;
    this.midiUi.learnArmed = { path, min, max, label };
    this.events.emit("midi-changed", undefined);
    this.events.emit("change", undefined);
  }

  cancelMidiLearn(): void {
    this.midiUi.learnActive = false;
    this.midiUi.learnArmed = null;
    this.events.emit("midi-changed", undefined);
    this.events.emit("change", undefined);
  }

  clearMidiMapping(cc: number): void {
    delete this.midiUi.ccMappings[cc];
    this.events.emit("midi-changed", undefined);
    this.events.emit("change", undefined);
  }

  private handleMidiCC(cc: number, value01: number): void {
    if (this.midiUi.learnActive && this.midiUi.learnArmed) {
      this.midiUi.ccMappings[cc] = this.midiUi.learnArmed;
      this.midiUi.learnArmed = null;
      this.midiUi.learnActive = false;
      this.events.emit("midi-changed", undefined);
      this.events.emit("change", undefined);
      return;
    }
    const mapping = this.midiUi.ccMappings[cc];
    if (!mapping) return;
    const value = mapping.min + (mapping.max - mapping.min) * value01;
    this.setByPath(mapping.path, value);
  }

  // ---- presets ----------------------------------------------------------

  loadPreset(id: string): boolean {
    const preset = this.presets.findById(id);
    if (!preset) return false;
    this.applyPreset(preset);
    this.currentPresetId = preset.id;
    this.currentPresetName = preset.name;
    this.dirty = false;
    this.events.emit("preset-loaded", preset);
    this.events.emit("change", undefined);
    this.persistSession();
    return true;
  }

  private applyPreset(preset: GlockworkPreset): void {
    // Clone before storing so live state can never alias (and accidentally mutate) an
    // object still sitting in the factory/user preset lists.
    this.engine.setParams(structuredCloneSafe(preset.engine));
    this.effectsParams = structuredCloneSafe(preset.effects);
    this.engine.setEffectsParams(this.effectsParams);
    this.arp.setParams(structuredCloneSafe(preset.arp));
    this.orffState = structuredCloneSafe(preset.performance.orff);
    this.performanceState = { transpose: preset.performance.transpose, velocity: preset.performance.velocity };
    this.transport.bpm = preset.performance.bpm;
  }

  buildCurrentPreset(name: string): GlockworkPreset {
    return sanitizePreset(
      {
        format: "mallet-synth-preset",
        version: 1,
        id: this.currentPresetId ?? uid("user"),
        name,
        category: "user",
        engine: this.engine.getParams(),
        arp: this.arp.getParams(),
        effects: this.effectsParams,
        performance: { orff: this.orffState, bpm: this.transport.bpm, ...this.performanceState },
      },
      name,
    );
  }

  saveCurrentAsPreset(name: string): GlockworkPreset {
    const preset = this.buildCurrentPreset(name);
    const saved = this.presets.saveAsUserPreset(preset, name);
    this.currentPresetId = saved.id;
    this.currentPresetName = saved.name;
    this.dirty = false;
    this.events.emit("presets-changed", undefined);
    this.events.emit("change", undefined);
    this.persistSession();
    return saved;
  }

  renamePreset(id: string, name: string): void {
    if (this.presets.rename(id, name)) {
      if (this.currentPresetId === id) this.currentPresetName = name;
      this.events.emit("presets-changed", undefined);
      this.events.emit("change", undefined);
    }
  }

  deletePreset(id: string): void {
    if (this.presets.delete(id)) {
      if (this.currentPresetId === id) {
        this.currentPresetId = null;
        this.dirty = true;
      }
      this.events.emit("presets-changed", undefined);
      this.events.emit("change", undefined);
    }
  }

  exportCurrentPresetJSON(name: string): string {
    return this.presets.exportJSON(this.buildCurrentPreset(name));
  }

  exportPresetJSON(id: string): string | null {
    const preset = this.presets.findById(id);
    return preset ? this.presets.exportJSON(preset) : null;
  }

  importPresetJSON(text: string): { ok: boolean; error: string | null; preset: GlockworkPreset | null } {
    const result = this.presets.importJSON(text);
    if (result.preset) {
      this.events.emit("presets-changed", undefined);
      this.events.emit("change", undefined);
      this.loadPreset(result.preset.id);
    }
    return { ok: result.preset !== null, error: result.error, preset: result.preset };
  }

  // ---- randomize ----------------------------------------------------------

  randomize(scope: "all" | "instrument" | "effects" | "arp"): void {
    this.preRandomSnapshot = {
      engine: structuredCloneSafe(this.engine.getParams()),
      effects: structuredCloneSafe(this.effectsParams),
      arp: structuredCloneSafe(this.arp.getParams()),
    };
    if (scope === "all" || scope === "instrument") this.randomizeInstrument(scope === "all");
    if (scope === "all" || scope === "effects") this.randomizeEffects();
    if (scope === "all" || scope === "arp") this.randomizeArp();
    this.dirty = true;
    this.events.emit("change", undefined);
    this.persistSession();
  }

  canUndoRandomize(): boolean {
    return this.preRandomSnapshot !== null;
  }

  undoRandomize(): void {
    if (!this.preRandomSnapshot) return;
    this.engine.setParams(this.preRandomSnapshot.engine);
    this.effectsParams = this.preRandomSnapshot.effects;
    this.engine.setEffectsParams(this.preRandomSnapshot.effects);
    this.arp.setParams(this.preRandomSnapshot.arp);
    this.preRandomSnapshot = null;
    this.events.emit("change", undefined);
    this.persistSession();
  }

  private randomizeInstrument(allowSwitch: boolean): void {
    let params = structuredCloneSafe(this.engine.getParams());
    if (allowSwitch && Math.random() < 0.3) {
      const pick = INSTRUMENTS[Math.floor(Math.random() * INSTRUMENTS.length)];
      params = structuredCloneSafe(pick.defaults);
    }
    const jitter = (v: number, amount = 0.35) => clamp(v + (Math.random() * 2 - 1) * amount, 0, 1);
    params.strike.hardness = jitter(params.strike.hardness);
    params.strike.attack = jitter(params.strike.attack);
    params.strike.strikeNoise = jitter(params.strike.strikeNoise, 0.25);
    params.bar.brightness = jitter(params.bar.brightness);
    params.bar.damping = jitter(params.bar.damping);
    params.bar.decay = jitter(params.bar.decay);
    params.bar.resonance = jitter(params.bar.resonance, 0.25);
    params.bar.inharmonicity = jitter(params.bar.inharmonicity, 0.2);
    params.bar.bodySize = jitter(params.bar.bodySize, 0.25);
    params.bar.bodyResonance = jitter(params.bar.bodyResonance, 0.25);
    params.tone.filterCutoff = jitter(params.tone.filterCutoff);
    params.tone.filterResonance = jitter(params.tone.filterResonance, 0.2);
    params.tone.hfDamping = jitter(params.tone.hfDamping, 0.2);
    params.tone.warmth = jitter(params.tone.warmth, 0.25);
    this.engine.setParams(params);
  }

  private randomizeEffects(): void {
    const e = structuredCloneSafe(this.effectsParams);
    const jitter = (v: number, amount = 0.3) => clamp(v + (Math.random() * 2 - 1) * amount, 0, 1);
    e.reverb.mix = jitter(e.reverb.mix);
    e.reverb.size = jitter(e.reverb.size, 0.25);
    e.reverb.decay = jitter(e.reverb.decay, 0.25);
    e.delay.mix = jitter(e.delay.mix);
    e.delay.feedback = jitter(e.delay.feedback, 0.25);
    e.chorus.mix = jitter(e.chorus.mix);
    e.chorus.depth = jitter(e.chorus.depth, 0.25);
    e.phaser.mix = jitter(e.phaser.mix);
    e.phaser.depth = jitter(e.phaser.depth, 0.25);
    e.tremolo.depth = jitter(e.tremolo.depth, 0.25);
    e.saturation.amount = jitter(e.saturation.amount, 0.25);
    if (Math.random() < 0.25) e.reverb.on = !e.reverb.on;
    if (Math.random() < 0.25) e.delay.on = Math.random() < 0.5;
    if (Math.random() < 0.2) e.chorus.on = Math.random() < 0.5;
    if (Math.random() < 0.2) e.phaser.on = Math.random() < 0.5;
    this.effectsParams = e;
    this.engine.setEffectsParams(e);
  }

  private randomizeArp(): void {
    const a = structuredCloneSafe(this.arp.getParams());
    const patterns = ["up", "down", "up-down", "down-up", "played", "random", "chord"] as const;
    const rates = ["1/4", "1/8", "1/8T", "1/16", "1/16T", "1/32"] as const;
    a.pattern = patterns[Math.floor(Math.random() * patterns.length)];
    a.rate = rates[Math.floor(Math.random() * rates.length)];
    a.octaveRange = 1 + Math.floor(Math.random() * 3);
    a.swing = Math.random() * 0.4;
    a.gateLength = clamp(0.4 + Math.random() * 0.5, 0.1, 1);
    a.probability = clamp(0.7 + Math.random() * 0.3, 0, 1);
    a.humanize = Math.random() * 0.2;
    a.velocityVariation = Math.random() * 0.4;
    this.arp.setParams(a);
  }

  // ---- session persistence -------------------------------------------------

  private persistSession(): void {
    try {
      const preset = this.buildCurrentPreset(this.currentPresetName);
      const session = {
        preset,
        presetId: this.currentPresetId,
        dirty: this.dirty,
        midi: { selectedInputId: this.midiUi.selectedInputId, channelFilter: this.midiUi.channelFilter, modDestination: this.midiUi.modDestination },
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      /* storage unavailable — session just won't persist */
    }
  }

  private restoreSession(): void {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) {
        this.loadPreset(this.presets.getFactoryPresets()[0].id);
        return;
      }
      const session = JSON.parse(raw);
      const preset = sanitizePreset(session.preset, "Init Xylophone");
      this.applyPreset(preset);
      this.currentPresetId = typeof session.presetId === "string" ? session.presetId : null;
      this.currentPresetName = preset.name;
      this.dirty = Boolean(session.dirty);
      if (session.midi) {
        if (typeof session.midi.selectedInputId === "string") this.midiUi.selectedInputId = session.midi.selectedInputId;
        if (session.midi.channelFilter === "omni" || typeof session.midi.channelFilter === "number") this.midiUi.channelFilter = session.midi.channelFilter;
        if (typeof session.midi.modDestination === "string") this.midiUi.modDestination = session.midi.modDestination as ModDestination;
      }
      this.midi.setSelectedInput(this.midiUi.selectedInputId);
      this.midi.setChannelFilter(this.midiUi.channelFilter);
      this.engine.setModDestination(this.midiUi.modDestination);
    } catch {
      this.loadPreset(this.presets.getFactoryPresets()[0].id);
    }
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function setDeep(obj: unknown, keys: string[], value: unknown): void {
  let cur = obj as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    const next = cur[keys[i]];
    if (typeof next !== "object" || next === null) return;
    cur = next as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}

function getDeep(obj: unknown, keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

export type { GlockworkPreset, PerformanceState };
export { SCALES };
