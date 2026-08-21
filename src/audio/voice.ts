import type { EngineParams, InstrumentModel } from "./types";
import { attackSeconds, bodyResonanceHz, decaySeconds, filterCutoffHz, filterQ, materialColor, stretchRatio } from "./mapping";
import { getSharedNoiseBuffer } from "./noise";
import { clamp, lerp, midiToFreq, centsToRatio, semitonesToRatio } from "../utils/math";

const MAX_PARTIALS = 7;

export interface VoiceOptions {
  ctx: AudioContext;
  destination: AudioNode;
  instrument: InstrumentModel;
  params: EngineParams;
  note: number;
  velocity: number; // 0..1
  pitchBendSemitones: number;
  hardnessBias: number; // live mod-wheel bias applied to new strikes only
  panBase: number; // -1..1, from voice-spread logic in the engine
  onEnded?: () => void;
  /** Precise AudioContext time to start the strike at. Defaults to ctx.currentTime, but the
   * arpeggiator schedules ahead of time for sample-accurate rhythm. */
  startTime?: number;
}

/** One struck mallet bar: additive partials + a resonant "body" formant + a short noise
 * excitation, all summed and routed through a per-voice filter before hitting the shared
 * output gain that voice-stealing/choking acts on. */
export class MalletVoice {
  readonly note: number;
  readonly startedAt: number;
  private ctx: AudioContext;
  private voiceGain: GainNode;
  private panner: StereoPannerNode;
  private oscillators: OscillatorNode[] = [];
  private stopped = false;
  private damping01: number;
  private maxTail: number;
  private onEnded?: () => void;
  private cleaned = false;
  private cleanupTimer = 0;

  constructor(opts: VoiceOptions) {
    const { ctx, destination, instrument, params, note, velocity, pitchBendSemitones, hardnessBias, panBase } = opts;
    this.onEnded = opts.onEnded;
    this.ctx = ctx;
    const now = opts.startTime ?? ctx.currentTime;
    this.startedAt = now;
    this.note = note;
    this.damping01 = params.bar.damping;

    const semis = instrument.registerOffset + params.pitch.octave * 12 + params.pitch.semitone + pitchBendSemitones;
    const fundamental = midiToFreq(note + semis) * centsToRatio(params.pitch.fine) * semitonesToRatio(0);
    const fundamentalHz = clamp(fundamental, 12, 19000);

    const vel = clamp(velocity, 0, 1);
    const velSens = params.strike.velocitySensitivity;
    const ampVel = lerp(1 - velSens * 0.85, 1, vel);
    const hardness = clamp(params.strike.hardness + hardnessBias + (vel - 0.7) * velSens * 0.35, 0, 1);
    const color = materialColor(params.bar.material);

    // --- output stage ---
    this.voiceGain = ctx.createGain();
    this.voiceGain.gain.value = 0;
    this.panner = ctx.createStereoPanner();
    this.panner.pan.value = clamp(panBase, -1, 1);
    this.voiceGain.connect(this.panner);
    this.panner.connect(destination);

    // --- per-voice tone shaping ---
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    const cutoff = filterCutoffHz(params.tone.filterCutoff) * lerp(0.8, 1.35, hardness);
    lowpass.frequency.value = clamp(cutoff, 150, 19000);
    lowpass.Q.value = filterQ(params.tone.filterResonance);
    // High-frequency damping: the filter darkens slightly over the note's life.
    const hfDampAmount = params.tone.hfDamping;
    if (hfDampAmount > 0.02) {
      const settled = clamp(lowpass.frequency.value * lerp(1, 0.3, hfDampAmount), 120, 19000);
      lowpass.frequency.setValueAtTime(lowpass.frequency.value, now);
      lowpass.frequency.setTargetAtTime(settled, now, decaySeconds(params.bar.decay) * 0.35);
    }

    const shaper = ctx.createWaveShaper();
    shaper.curve = warmthCurve(params.tone.warmth) as Float32Array<ArrayBuffer>;
    shaper.oversample = "2x";
    lowpass.connect(shaper);
    shaper.connect(this.voiceGain);

    const partialBus = ctx.createGain();
    partialBus.gain.value = 1;
    partialBus.connect(lowpass);

    // --- body resonance formant ---
    if (params.bar.bodyResonance > 0.01) {
      const bodyFilter = ctx.createBiquadFilter();
      bodyFilter.type = "bandpass";
      bodyFilter.frequency.value = bodyResonanceHz(params.bar.bodySize, fundamentalHz);
      bodyFilter.Q.value = lerp(1.2, 9, params.bar.resonance);
      const bodyGain = ctx.createGain();
      bodyGain.gain.value = params.bar.bodyResonance * 0.9;
      partialBus.connect(bodyFilter);
      bodyFilter.connect(bodyGain);
      bodyGain.connect(lowpass);
    }

    // --- FM shimmer (glass/synthetic/experimental instruments) ---
    let fmGain: GainNode | null = null;
    if (params.fm.enabled) {
      const fmOsc = ctx.createOscillator();
      fmOsc.type = "sine";
      fmOsc.frequency.value = fundamentalHz * params.fm.ratio;
      fmGain = ctx.createGain();
      const peakDeviation = fundamentalHz * (0.3 + params.fm.index * 5);
      fmGain.gain.value = peakDeviation;
      fmGain.gain.setTargetAtTime(peakDeviation * 0.25, now, 0.18);
      fmOsc.connect(fmGain);
      fmOsc.start(now);
      this.oscillators.push(fmOsc);
    }

    // --- additive partials ---
    const attack = attackSeconds(params.strike.attack);
    const baseDecay = decaySeconds(params.bar.decay);
    const dampingSpread = lerp(1.7, 0.3, params.bar.damping);
    const hfMul = lerp(1, 0.22, params.tone.hfDamping);
    const tilt = lerp(0.5, 1.85, params.bar.brightness);
    const partials = instrument.partials.slice(0, MAX_PARTIALS);
    let longestTail = 0;

    partials.forEach((p, i) => {
      const n = partials.length - 1 || 1;
      const ratio = stretchRatio(p.ratio, i, params.bar.inharmonicity, color.stretch);
      const freq = fundamentalHz * ratio;
      if (freq > 19500 || freq < 8) return;

      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      if (fmGain && i < 2) fmGain.connect(osc.frequency);

      const gainNode = ctx.createGain();
      const spectralTilt = Math.pow(tilt, i);
      const levelBase = i === 0 ? params.bar.fundamentalLevel : params.bar.partialAmount * p.gain;
      const target = clamp(levelBase * spectralTilt * ampVel, 0, 4) * 0.42;

      const partialDampingMul = lerp(1, dampingSpread, i / n);
      const partialHfMul = lerp(1, hfMul, i / n);
      const decayTime = Math.max(0.04, baseDecay * p.decay * partialDampingMul * partialHfMul);
      const atk = attack * (1 + i * 0.12);

      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(target, now + atk);
      gainNode.gain.setTargetAtTime(0, now + atk, decayTime / 4);

      osc.connect(gainNode);
      gainNode.connect(partialBus);

      const tail = atk + decayTime * 4 + 0.15;
      if (tail > longestTail) longestTail = tail;
      osc.start(now);
      this.oscillators.push(osc);
    });

    // --- strike noise excitation ---
    if (params.strike.strikeNoise > 0.01) {
      const noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = getSharedNoiseBuffer(ctx);
      const buf = noiseSrc.buffer;
      const burstDuration = lerp(0.09, 0.008, hardness * 0.6 + params.strike.attack * 0.4);
      const offset = Math.random() * Math.max(0.01, buf.duration - burstDuration - 0.05);

      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = "bandpass";
      const center = clamp(fundamentalHz * color.noiseCenterMul * (0.6 + hardness * 1.3), 200, 18500);
      noiseFilter.frequency.value = center;
      noiseFilter.Q.value = color.noiseQ;

      const noiseGain = ctx.createGain();
      const noiseLevel = params.strike.strikeNoise * (0.3 + 0.7 * vel) * 0.5;
      noiseGain.gain.setValueAtTime(0, now);
      noiseGain.gain.linearRampToValueAtTime(noiseLevel, now + Math.min(0.004, burstDuration * 0.3));
      noiseGain.gain.setTargetAtTime(0, now + burstDuration * 0.3, burstDuration / 3);

      noiseSrc.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(lowpass);
      noiseSrc.start(now, offset, burstDuration + 0.05);
      longestTail = Math.max(longestTail, burstDuration + 0.1);
    }

    this.voiceGain.gain.setValueAtTime(0, now);
    this.voiceGain.gain.linearRampToValueAtTime(1, now + Math.max(0.002, attack * 0.5));

    this.maxTail = Math.max(longestTail, 0.3);
    const stopAt = now + this.maxTail + 0.05;
    for (const osc of this.oscillators) {
      try {
        osc.stop(stopAt);
      } catch {
        /* already stopped */
      }
    }
    const scheduleOffsetMs = Math.max(0, now - ctx.currentTime) * 1000;
    const cleanupDelay = Math.max(50, this.maxTail * 1000 + 80 + scheduleOffsetMs);
    this.cleanupTimer = window.setTimeout(() => this.hardCleanup(), cleanupDelay);
  }

  /** Cuts the voice short (key released / voice stolen). If `natural` is false this is a
   * hand-damp style choke rather than the bar's own decay finishing. */
  stop(choke: boolean): void {
    if (this.stopped) return;
    this.stopped = true;
    const now = this.ctx.currentTime;
    if (choke) {
      const chokeTime = clamp(lerp(0.35, 0.04, this.damping01), 0.03, 0.4);
      const current = this.voiceGain.gain.value;
      this.voiceGain.gain.cancelScheduledValues(now);
      this.voiceGain.gain.setValueAtTime(current, now);
      this.voiceGain.gain.linearRampToValueAtTime(0, now + chokeTime);
      const stopAt = now + chokeTime + 0.02;
      window.clearTimeout(this.cleanupTimer);
      this.cleanupTimer = window.setTimeout(() => this.hardCleanup(), (chokeTime + 0.08) * 1000);
      for (const osc of this.oscillators) {
        try {
          osc.stop(stopAt);
        } catch {
          /* ignore */
        }
      }
    }
  }

  private hardCleanup(): void {
    if (this.cleaned) return;
    this.cleaned = true;
    for (const osc of this.oscillators) {
      try {
        osc.disconnect();
      } catch {
        /* ignore */
      }
    }
    try {
      this.voiceGain.disconnect();
      this.panner.disconnect();
    } catch {
      /* ignore */
    }
    this.onEnded?.();
  }
}

function warmthCurve(warmth: number): Float32Array {
  const amount = clamp(warmth, 0, 1);
  const n = 256;
  const curve = new Float32Array(n);
  const drive = 1 + amount * 4;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return curve;
}
