import { clamp, lerp, logScale } from "../utils/math";
import { rateToSeconds, type ArpRate } from "./timing";

export interface ReverbParams {
  on: boolean;
  mix: number;
  size: number;
  decay: number;
  damping: number;
}
export interface DelayParams {
  on: boolean;
  mix: number;
  time: number;
  feedback: number;
  pingPong: boolean;
  sync: boolean;
  rate: ArpRate;
}
export interface ChorusParams {
  on: boolean;
  mix: number;
  rate: number;
  depth: number;
}
export interface TremoloParams {
  on: boolean;
  rate: number;
  depth: number;
  sync: boolean;
  rateNote: ArpRate;
}
export interface PhaserParams {
  on: boolean;
  mix: number;
  rate: number;
  depth: number;
}
export interface SaturationParams {
  on: boolean;
  amount: number;
}
export interface EqParams {
  low: number;
  mid: number;
  high: number;
}
export interface MasterParams {
  gain: number;
  limiterOn: boolean;
}

export interface EffectsParams {
  reverb: ReverbParams;
  delay: DelayParams;
  chorus: ChorusParams;
  tremolo: TremoloParams;
  phaser: PhaserParams;
  saturation: SaturationParams;
  eq: EqParams;
  master: MasterParams;
}

export function defaultEffectsParams(): EffectsParams {
  return {
    reverb: { on: true, mix: 0.28, size: 0.5, decay: 0.45, damping: 0.4 },
    delay: { on: false, mix: 0.25, time: 0.3, feedback: 0.35, pingPong: true, sync: true, rate: "1/8" },
    chorus: { on: false, mix: 0.25, rate: 0.3, depth: 0.4 },
    tremolo: { on: false, rate: 0.4, depth: 0.5, sync: false, rateNote: "1/8" },
    phaser: { on: false, mix: 0.35, rate: 0.25, depth: 0.5 },
    saturation: { on: false, amount: 0.2 },
    eq: { low: 0.5, mid: 0.5, high: 0.5 },
    master: { gain: 0.85, limiterOn: true },
  };
}

const RAMP = 0.03;

function setTarget(param: AudioParam, ctx: BaseAudioContext, value: number, timeConstant = RAMP): void {
  param.setTargetAtTime(value, ctx.currentTime, timeConstant);
}

class SaturationStage {
  readonly input: GainNode;
  readonly output: GainNode;
  private dry: GainNode;
  private wet: GainNode;
  private shaper: WaveShaperNode;

  constructor(private ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = "4x";
    this.shaper.curve = makeSatCurve(6) as Float32Array<ArrayBuffer>;
    this.input.connect(this.dry).connect(this.output);
    this.input.connect(this.shaper).connect(this.wet).connect(this.output);
    this.wet.gain.value = 0;
  }

  update(p: SaturationParams): void {
    const wet = p.on ? clamp(p.amount, 0, 1) : 0;
    setTarget(this.wet.gain, this.ctx, wet);
    setTarget(this.dry.gain, this.ctx, 1 - wet * 0.35);
  }
}

class TremoloStage {
  readonly input: GainNode;
  readonly output: GainNode;
  private lfo: OscillatorNode;
  private depthGain: GainNode;
  private lastParams: TremoloParams | null = null;
  private modBoost = 0;

  constructor(private ctx: AudioContext, private getBpm: () => number) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.input.connect(this.output);
    this.lfo = ctx.createOscillator();
    this.lfo.type = "sine";
    this.depthGain = ctx.createGain();
    this.depthGain.gain.value = 0;
    this.lfo.connect(this.depthGain).connect(this.output.gain);
    this.output.gain.value = 1;
    this.lfo.start();
  }

  update(p: TremoloParams): void {
    this.lastParams = p;
    const freq = p.sync ? 1 / Math.max(0.02, rateToSeconds(p.rateNote, this.getBpm())) : logScale(p.rate, 0.5, 12);
    setTarget(this.lfo.frequency as unknown as AudioParam, this.ctx, freq, 0.05);
    this.applyDepth();
  }

  setModBoost(amount: number): void {
    this.modBoost = amount;
    this.applyDepth();
  }

  private applyDepth(): void {
    const p = this.lastParams;
    const depth = p?.on ? clamp(p.depth + this.modBoost, 0, 1) : clamp(this.modBoost, 0, 1);
    setTarget(this.depthGain.gain, this.ctx, depth * 0.5);
    setTarget(this.output.gain, this.ctx, 1 - depth * 0.5);
  }
}

class ChorusStage {
  readonly input: GainNode;
  readonly output: GainNode;
  private dry: GainNode;
  private wet: GainNode;
  private delayL: DelayNode;
  private delayR: DelayNode;
  private lfoA: OscillatorNode;
  private lfoB: OscillatorNode;
  private depthGainA: GainNode;
  private depthGainB: GainNode;

  constructor(private ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.delayL = ctx.createDelay(0.05);
    this.delayR = ctx.createDelay(0.05);
    this.delayL.delayTime.value = 0.012;
    this.delayR.delayTime.value = 0.014;

    this.input.connect(this.dry).connect(this.output);
    this.input.connect(this.delayL);
    this.input.connect(this.delayR);
    this.delayL.connect(this.wet);
    this.delayR.connect(this.wet);
    this.wet.connect(this.output);

    this.lfoA = ctx.createOscillator();
    this.lfoA.type = "sine";
    this.lfoB = ctx.createOscillator();
    this.lfoB.type = "sine";
    this.depthGainA = ctx.createGain();
    this.depthGainB = ctx.createGain();
    this.depthGainA.gain.value = 0.002;
    this.depthGainB.gain.value = -0.002;
    this.lfoA.connect(this.depthGainA).connect(this.delayL.delayTime);
    this.lfoB.connect(this.depthGainB).connect(this.delayR.delayTime);
    this.lfoA.frequency.value = 0.3;
    this.lfoB.frequency.value = 0.33;
    this.lfoA.start();
    this.lfoB.start();
  }

  update(p: ChorusParams): void {
    const rate = logScale(p.rate, 0.05, 5);
    setTarget(this.lfoA.frequency as unknown as AudioParam, this.ctx, rate, 0.05);
    setTarget(this.lfoB.frequency as unknown as AudioParam, this.ctx, rate * 1.08, 0.05);
    const depthSeconds = lerp(0.0007, 0.006, clamp(p.depth, 0, 1));
    setTarget(this.depthGainA.gain, this.ctx, depthSeconds);
    setTarget(this.depthGainB.gain, this.ctx, -depthSeconds);
    const wet = p.on ? clamp(p.mix, 0, 1) : 0;
    setTarget(this.wet.gain, this.ctx, wet);
    setTarget(this.dry.gain, this.ctx, 1 - wet * 0.5);
  }
}

class PhaserStage {
  readonly input: GainNode;
  readonly output: GainNode;
  private dry: GainNode;
  private wet: GainNode;
  private stages: BiquadFilterNode[] = [];
  private lfo: OscillatorNode;
  private lfoDepth: GainNode;
  private feedbackGain: GainNode;
  private feedbackSum: GainNode;

  constructor(private ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.feedbackSum = ctx.createGain();
    this.feedbackGain = ctx.createGain();
    this.feedbackGain.gain.value = 0;

    this.input.connect(this.dry).connect(this.output);
    this.input.connect(this.feedbackSum);

    let node: AudioNode = this.feedbackSum;
    for (let i = 0; i < 4; i++) {
      const ap = ctx.createBiquadFilter();
      ap.type = "allpass";
      ap.frequency.value = 800;
      node.connect(ap);
      node = ap;
      this.stages.push(ap);
    }
    node.connect(this.wet);
    node.connect(this.feedbackGain);
    this.feedbackGain.connect(this.feedbackSum);
    this.wet.connect(this.output);

    this.lfo = ctx.createOscillator();
    this.lfo.type = "sine";
    this.lfo.frequency.value = 0.3;
    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.value = 400;
    this.lfo.connect(this.lfoDepth);
    for (const ap of this.stages) this.lfoDepth.connect(ap.frequency);
    this.lfo.start();
  }

  update(p: PhaserParams): void {
    const rate = logScale(p.rate, 0.05, 6);
    setTarget(this.lfo.frequency as unknown as AudioParam, this.ctx, rate, 0.05);
    const depth = clamp(p.depth, 0, 1);
    setTarget(this.lfoDepth.gain, this.ctx, lerp(150, 1600, depth));
    for (const ap of this.stages) setTarget(ap.frequency, this.ctx, lerp(400, 1400, depth), 0.05);
    setTarget(this.feedbackGain.gain, this.ctx, p.on ? depth * 0.7 : 0);
    const wet = p.on ? clamp(p.mix, 0, 1) : 0;
    setTarget(this.wet.gain, this.ctx, wet);
    setTarget(this.dry.gain, this.ctx, 1 - wet * 0.5);
  }
}

class DelayStage {
  readonly input: GainNode;
  readonly output: GainNode;
  private dry: GainNode;
  private wet: GainNode;
  private delayA: DelayNode;
  private delayB: DelayNode;
  private fbA: GainNode;
  private fbB: GainNode;
  private panA: StereoPannerNode;
  private panB: StereoPannerNode;

  constructor(private ctx: AudioContext, private getBpm: () => number) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.delayA = ctx.createDelay(2);
    this.delayB = ctx.createDelay(2);
    this.fbA = ctx.createGain();
    this.fbB = ctx.createGain();
    this.panA = ctx.createStereoPanner();
    this.panB = ctx.createStereoPanner();

    this.input.connect(this.dry).connect(this.output);
    this.input.connect(this.delayA);
    this.delayA.connect(this.panA);
    this.panA.connect(this.wet);
    this.delayA.connect(this.fbA).connect(this.delayB);
    this.delayB.connect(this.panB);
    this.panB.connect(this.wet);
    this.delayB.connect(this.fbB).connect(this.delayA);
    this.wet.connect(this.output);
  }

  update(p: DelayParams): void {
    const seconds = clamp(p.sync ? rateToSeconds(p.rate, this.getBpm()) : logScale(p.time, 0.02, 1.3), 0.01, 1.95);
    const now = this.ctx.currentTime;
    this.delayA.delayTime.linearRampToValueAtTime(seconds, now + 0.05);
    this.delayB.delayTime.linearRampToValueAtTime(seconds, now + 0.05);
    const fb = clamp(p.feedback, 0, 0.92);
    setTarget(this.fbA.gain, this.ctx, fb);
    setTarget(this.fbB.gain, this.ctx, fb);
    this.panA.pan.setTargetAtTime(p.pingPong ? -1 : 0, now, 0.05);
    this.panB.pan.setTargetAtTime(p.pingPong ? 1 : 0, now, 0.05);
    const wet = p.on ? clamp(p.mix, 0, 1) : 0;
    setTarget(this.wet.gain, this.ctx, wet);
    setTarget(this.dry.gain, this.ctx, 1);
  }
}

class ReverbStage {
  readonly input: GainNode;
  readonly output: GainNode;
  private dry: GainNode;
  private wet: GainNode;
  private convolver: ConvolverNode;
  private lastKey = "";
  private lastParams: ReverbParams | null = null;
  private modBoost = 0;

  constructor(private ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0;
    this.convolver = ctx.createConvolver();
    this.input.connect(this.dry).connect(this.output);
    this.input.connect(this.convolver).connect(this.wet).connect(this.output);
  }

  update(p: ReverbParams): void {
    this.lastParams = p;
    const key = `${p.size.toFixed(2)}-${p.decay.toFixed(2)}-${p.damping.toFixed(2)}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.convolver.buffer = buildImpulseResponse(this.ctx, logScale(p.decay, 0.3, 7), p.damping, p.size);
    }
    this.applyWet();
    setTarget(this.dry.gain, this.ctx, 1);
  }

  setModBoost(amount: number): void {
    this.modBoost = amount;
    this.applyWet();
  }

  private applyWet(): void {
    const p = this.lastParams;
    const wet = p?.on ? clamp(p.mix + this.modBoost, 0, 1) : clamp(this.modBoost, 0, 1);
    setTarget(this.wet.gain, this.ctx, wet);
  }
}

class EqStage {
  readonly input: BiquadFilterNode;
  readonly output: BiquadFilterNode;
  private low: BiquadFilterNode;
  private mid: BiquadFilterNode;
  private high: BiquadFilterNode;

  constructor(private ctx: AudioContext) {
    this.low = ctx.createBiquadFilter();
    this.low.type = "lowshelf";
    this.low.frequency.value = 200;
    this.mid = ctx.createBiquadFilter();
    this.mid.type = "peaking";
    this.mid.frequency.value = 1200;
    this.mid.Q.value = 0.9;
    this.high = ctx.createBiquadFilter();
    this.high.type = "highshelf";
    this.high.frequency.value = 5500;
    this.low.connect(this.mid);
    this.mid.connect(this.high);
    this.input = this.low;
    this.output = this.high;
  }

  update(p: EqParams): void {
    setTarget(this.low.gain, this.ctx, lerp(-14, 14, p.low), 0.05);
    setTarget(this.mid.gain, this.ctx, lerp(-14, 14, p.mid), 0.05);
    setTarget(this.high.gain, this.ctx, lerp(-14, 14, p.high), 0.05);
  }
}

/** The full send/insert effects chain: saturation -> tremolo -> chorus -> phaser -> delay ->
 * reverb -> EQ -> limiter -> master gain. Every stage mixes its own dry/wet so "bypass" is
 * always click-free. */
export class EffectsChain {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly meter: AnalyserNode;

  private saturation: SaturationStage;
  private tremolo: TremoloStage;
  private chorus: ChorusStage;
  private phaser: PhaserStage;
  private delay: DelayStage;
  private reverb: ReverbStage;
  private eq: EqStage;
  private limiter: DynamicsCompressorNode;
  private masterGain: GainNode;

  constructor(private ctx: AudioContext, getBpm: () => number) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();

    this.saturation = new SaturationStage(ctx);
    this.tremolo = new TremoloStage(ctx, getBpm);
    this.chorus = new ChorusStage(ctx);
    this.phaser = new PhaserStage(ctx);
    this.delay = new DelayStage(ctx, getBpm);
    this.reverb = new ReverbStage(ctx);
    this.eq = new EqStage(ctx);
    this.limiter = ctx.createDynamicsCompressor();
    this.masterGain = ctx.createGain();
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 512;
    this.meter.smoothingTimeConstant = 0.75;

    this.input.connect(this.saturation.input);
    this.saturation.output.connect(this.tremolo.input);
    this.tremolo.output.connect(this.chorus.input);
    this.chorus.output.connect(this.phaser.input);
    this.phaser.output.connect(this.delay.input);
    this.delay.output.connect(this.reverb.input);
    this.reverb.output.connect(this.eq.input);
    this.eq.output.connect(this.limiter);
    this.limiter.connect(this.masterGain);
    this.masterGain.connect(this.meter);
    this.meter.connect(this.output);
  }

  update(p: EffectsParams): void {
    this.saturation.update(p.saturation);
    this.tremolo.update(p.tremolo);
    this.chorus.update(p.chorus);
    this.phaser.update(p.phaser);
    this.delay.update(p.delay);
    this.reverb.update(p.reverb);
    this.eq.update(p.eq);
    setTarget(this.masterGain.gain, this.ctx, clamp(p.master.gain, 0, 1.5));
    if (p.master.limiterOn) {
      this.limiter.threshold.setTargetAtTime(-6, this.ctx.currentTime, 0.05);
      this.limiter.ratio.setTargetAtTime(20, this.ctx.currentTime, 0.05);
      this.limiter.knee.setTargetAtTime(4, this.ctx.currentTime, 0.05);
      this.limiter.attack.setTargetAtTime(0.002, this.ctx.currentTime, 0.05);
      this.limiter.release.setTargetAtTime(0.15, this.ctx.currentTime, 0.05);
    } else {
      this.limiter.threshold.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      this.limiter.ratio.setTargetAtTime(1, this.ctx.currentTime, 0.05);
    }
  }

  /** Live mod-wheel style bias layered on top of the stored patch values, used for the
   * "Reverb" and "Tremolo" mod-wheel destinations. */
  setReverbModBoost(amount: number): void {
    this.reverb.setModBoost(amount);
  }

  setTremoloModBoost(amount: number): void {
    this.tremolo.setModBoost(amount);
  }
}

function buildImpulseResponse(ctx: AudioContext, decaySeconds: number, damping01: number, size01: number): AudioBuffer {
  const predelay = Math.floor(size01 * 0.035 * ctx.sampleRate);
  const len = Math.max(1, Math.floor(ctx.sampleRate * decaySeconds) + predelay);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  const damping = clamp(damping01, 0, 1);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      if (i < predelay) {
        data[i] = 0;
        continue;
      }
      const t = (i - predelay) / Math.max(1, len - predelay);
      const env = Math.pow(1 - t, lerp(1.4, 4.2, size01));
      const coef = lerp(0.75, 0.05, damping * 0.6 + t * damping * 0.4);
      const white = Math.random() * 2 - 1;
      lp += (white - lp) * coef;
      data[i] = lp * env;
    }
  }
  return ir;
}

function makeSatCurve(drive: number): Float32Array {
  const n = 512;
  const curve = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / norm;
  }
  return curve;
}
