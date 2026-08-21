import { getInstrument } from "./instruments";
import { MalletVoice } from "./voice";
import { EffectsChain, defaultEffectsParams, type EffectsParams } from "./effects";
import type { EngineParams, ModDestination } from "./types";
import { motorHz } from "./mapping";
import { clamp, lerp } from "../utils/math";
import { Emitter } from "../utils/events";

const MAX_POLYPHONY = 28;
const PITCH_BEND_RANGE_SEMITONES = 2;

interface ActiveVoice {
  id: number;
  note: number;
  voice: MalletVoice;
  heldBySustain: boolean;
  releasedKey: boolean;
}

interface EngineEvents {
  "voice-start": { id: number; note: number; velocity: number; fromArp: boolean };
  "voice-end": { id: number; note: number };
  "level": { rms: number; peak: number };
  [key: string]: unknown;
}

/** Owns the AudioContext, the master signal chain, and the voice pool. UI and MIDI/arp
 * layers only ever talk to this class — never to raw AudioNodes. */
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly events = new Emitter<EngineEvents>();
  readonly effects: EffectsChain;

  private voiceBus: GainNode;
  private motorGain: GainNode;
  private motorLfo: OscillatorNode;
  private motorDepthGain: GainNode;
  private widenerInput: GainNode;
  private widenerOutput: GainNode;
  private widthGain: GainNode;
  private masterFilter: BiquadFilterNode;
  private brightnessShelf: BiquadFilterNode;

  private params: EngineParams;
  private effectsParams: EffectsParams = defaultEffectsParams();
  private voices: ActiveVoice[] = [];
  private nextVoiceId = 1;
  private sustainOn = false;
  private pitchBendSemitones = 0;
  private modWheelValue = 0;
  private modDestination: ModDestination = "brightness";
  private hardnessBias = 0;
  private motorModBoost = 0;
  private bpm: () => number;

  constructor(getBpm: () => number) {
    this.bpm = getBpm;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC({ latencyHint: "interactive" });

    this.voiceBus = this.ctx.createGain();
    this.voiceBus.gain.value = 0.5;

    // Vibraphone-style motor tremolo (shared LFO, usable on any instrument).
    this.motorGain = this.ctx.createGain();
    this.motorGain.gain.value = 1;
    this.motorLfo = this.ctx.createOscillator();
    this.motorLfo.type = "sine";
    this.motorLfo.frequency.value = 4;
    this.motorDepthGain = this.ctx.createGain();
    this.motorDepthGain.gain.value = 0;
    this.motorLfo.connect(this.motorDepthGain).connect(this.motorGain.gain);
    this.motorLfo.start();

    // Mod-wheel destinations that act on the whole mix in real time.
    this.brightnessShelf = this.ctx.createBiquadFilter();
    this.brightnessShelf.type = "highshelf";
    this.brightnessShelf.frequency.value = 4000;
    this.brightnessShelf.gain.value = 0;

    this.masterFilter = this.ctx.createBiquadFilter();
    this.masterFilter.type = "lowpass";
    this.masterFilter.frequency.value = 19000;
    this.masterFilter.Q.value = 0.5;

    // Stereo widener (mid/side).
    this.widenerInput = this.ctx.createGain();
    this.widenerOutput = this.ctx.createGain();
    this.widthGain = this.ctx.createGain();
    this.buildWidener();

    this.effects = new EffectsChain(this.ctx, getBpm);

    this.voiceBus.connect(this.motorGain);
    this.motorGain.connect(this.brightnessShelf);
    this.brightnessShelf.connect(this.masterFilter);
    this.masterFilter.connect(this.widenerInput);
    this.widenerOutput.connect(this.effects.input);
    this.effects.output.connect(this.ctx.destination);

    this.params = getInstrument("orff-alto-xylo").defaults;
    this.effects.update(this.effectsParams);
    this.setParams(this.params);
  }

  private buildWidener(): void {
    const splitter = this.ctx.createChannelSplitter(2);
    const merger = this.ctx.createChannelMerger(2);
    this.widenerInput.connect(splitter);

    const midL = this.ctx.createGain();
    midL.gain.value = 0.5;
    const midR = this.ctx.createGain();
    midR.gain.value = 0.5;
    const sideL = this.ctx.createGain();
    sideL.gain.value = 0.5;
    const sideR = this.ctx.createGain();
    sideR.gain.value = -0.5;

    splitter.connect(midL, 0);
    splitter.connect(midR, 1);
    splitter.connect(sideL, 0);
    splitter.connect(sideR, 1);

    const midSum = this.ctx.createGain();
    const sideSum = this.ctx.createGain();
    midL.connect(midSum);
    midR.connect(midSum);
    sideL.connect(sideSum);
    sideR.connect(sideSum);

    sideSum.connect(this.widthGain);
    const negWidth = this.ctx.createGain();
    negWidth.gain.value = -1;
    this.widthGain.connect(negWidth);

    midSum.connect(merger, 0, 0);
    midSum.connect(merger, 0, 1);
    this.widthGain.connect(merger, 0, 0);
    negWidth.connect(merger, 0, 1);
    merger.connect(this.widenerOutput);
    this.widthGain.gain.value = 1;
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  // ---- patch management -------------------------------------------------

  getParams(): EngineParams {
    return this.params;
  }

  setParams(params: EngineParams): void {
    this.params = params;
    this.applyMotor();
    this.widthGain.gain.setTargetAtTime(lerp(0, 2, params.stereo.width), this.ctx.currentTime, 0.05);
  }

  getEffectsParams(): EffectsParams {
    return this.effectsParams;
  }

  setEffectsParams(effects: EffectsParams): void {
    this.effectsParams = effects;
    this.effects.update(effects);
  }

  // ---- performance state --------------------------------------------------

  setSustain(on: boolean): void {
    this.sustainOn = on;
    if (!on) {
      for (const v of this.voices) {
        if (v.heldBySustain) {
          v.voice.stop(true);
          v.heldBySustain = false;
        }
      }
    }
  }

  setPitchBend(bendMinusOneToOne: number): void {
    this.pitchBendSemitones = clamp(bendMinusOneToOne, -1, 1) * PITCH_BEND_RANGE_SEMITONES;
  }

  setModWheel(value01: number): void {
    this.modWheelValue = clamp(value01, 0, 1);
    this.applyModDestination();
  }

  setModDestination(dest: ModDestination): void {
    this.modDestination = dest;
    this.applyModDestination();
  }

  private applyModDestination(): void {
    const w = this.modWheelValue;
    const now = this.ctx.currentTime;
    this.brightnessShelf.gain.setTargetAtTime(this.modDestination === "brightness" ? lerp(0, 11, w) : 0, now, 0.04);
    if (this.modDestination === "filter") {
      this.masterFilter.frequency.setTargetAtTime(lerp(19000, 900, w), now, 0.04);
      this.masterFilter.Q.setTargetAtTime(lerp(0.5, 8, w), now, 0.04);
    } else {
      this.masterFilter.frequency.setTargetAtTime(19000, now, 0.04);
      this.masterFilter.Q.setTargetAtTime(0.5, now, 0.04);
    }
    this.effects.setReverbModBoost(this.modDestination === "reverb" ? w * 0.55 : 0);
    this.effects.setTremoloModBoost(this.modDestination === "tremolo" ? w * 0.55 : 0);
    this.motorModBoost = this.modDestination === "motorDepth" ? w * 0.6 : 0;
    this.applyMotor();
    this.hardnessBias = this.modDestination === "hardness" ? w * 0.4 : 0;
  }

  private applyMotor(): void {
    const m = this.params.motor;
    const now = this.ctx.currentTime;
    this.motorLfo.frequency.setTargetAtTime(motorHz(m.speed), now, 0.05);
    const depth = m.on ? clamp(m.depth + this.motorModBoost, 0, 1) : clamp(this.motorModBoost, 0, 1);
    this.motorDepthGain.gain.setTargetAtTime(depth * 0.45, now, 0.05);
    this.motorGain.gain.setTargetAtTime(1 - depth * 0.45, now, 0.05);
  }

  // ---- notes --------------------------------------------------------------

  noteOn(note: number, velocity01: number, fromArp = false, when?: number): number {
    if (this.voices.length >= MAX_POLYPHONY) {
      const victim = this.voices.shift();
      victim?.voice.stop(true);
    }
    const instrument = getInstrument(this.params.instrumentId);
    const spreadPos = clamp((note - 60) / 24, -1, 1);
    const jitter = (Math.random() * 2 - 1) * this.params.stereo.panRandom * 0.7;
    const panBase = clamp(spreadPos * this.params.stereo.voiceSpread + jitter, -1, 1);

    const id = this.nextVoiceId++;
    const voice = new MalletVoice({
      ctx: this.ctx,
      destination: this.voiceBus,
      instrument,
      params: this.params,
      note,
      velocity: velocity01,
      pitchBendSemitones: this.pitchBendSemitones,
      hardnessBias: this.hardnessBias,
      panBase,
      startTime: when,
      onEnded: () => {
        this.voices = this.voices.filter((v) => v.id !== id);
        this.events.emit("voice-end", { id, note });
      },
    });
    this.voices.push({ id, note, voice, heldBySustain: false, releasedKey: false });
    this.events.emit("voice-start", { id, note, velocity: velocity01, fromArp });
    return id;
  }

  noteOff(note: number): void {
    for (const v of this.voices) {
      if (v.note === note && !v.releasedKey) {
        v.releasedKey = true;
        if (this.sustainOn) {
          v.heldBySustain = true;
        } else {
          v.voice.stop(true);
        }
      }
    }
  }

  /** Chokes only the specific voice returned by noteOn (used by the arpeggiator's gate
   * length, which must not choke an overlapping manually-played instance of the same note). */
  releaseVoice(id: number): void {
    const v = this.voices.find((x) => x.id === id);
    if (v && !v.releasedKey) {
      v.releasedKey = true;
      if (this.sustainOn) v.heldBySustain = true;
      else v.voice.stop(true);
    }
  }

  panic(): void {
    for (const v of this.voices) v.voice.stop(true);
    this.voices = [];
  }

  getActiveNoteCount(): number {
    return this.voices.length;
  }
}
