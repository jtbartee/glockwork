// ENSEMBLE MIXER. The audio graph for a multitrack piece, built on GLOCKWORK's own MalletVoice and
// identical in a live AudioContext and an OfflineAudioContext (WAV export), so what is exported is
// what was heard.
//
//   voice → track input → motor (vibraphone tremolo, when the patch has one) → pan → fader
//         → ensemble bus ─────────────────────────────┐
//   fader → reverb send → shared reverb ───────────────┤→ headroom → limiter → master → meter → out
//   fader → delay send → shared ping-pong delay ───────┘
//
// Voices are allocated by event time, not by the audio clock, so live playback and offline render
// make the same decisions: a bar struck again while still ringing is damped first (as a player's
// mallet does), sustaining instruments are hand-damped at the end of a note where the part asks for
// it, and per-track and global voice budgets steal the oldest, most-decayed voice when exceeded.
// The shared reverb's impulse is seeded and cut at −90 dB (convolver cost grows with its length).

import { getInstrument } from "../audio/instruments";
import { motorHz } from "../audio/mapping";
import { MalletVoice } from "../audio/voice";
import { dampsAtNoteEnd, ensembleInfo } from "../compose/instruments";
import type { Composition, MasterSettings, NoteEvent, Track } from "../compose/types";
import { clamp, lerp } from "../utils/math";

export type Quality = "performance" | "balanced" | "high";

export const VOICE_BUDGET: Record<Quality, { perTrack: number; global: number; tailFactor: number }> = {
  performance: { perTrack: 6, global: 40, tailFactor: 1.8 },
  balanced: { perTrack: 10, global: 64, tailFactor: 2.2 },
  high: { perTrack: 16, global: 110, tailFactor: 2.6 },
};

interface Strip {
  track: Track;
  input: GainNode;
  motor: GainNode;
  lfo: OscillatorNode | null;
  lfoDepth: GainNode | null;
  pan: StereoPannerNode;
  fader: GainNode;
  reverb: GainNode;
  delay: GainNode;
}

interface LiveVoice {
  voice: MalletVoice;
  trackId: string;
  midi: number;
  start: number;
  end: number;
  peak: number;
  decay: number;
  generation: number;
}

export interface MixerStats {
  voicesStarted: number;
  stolen: number;
  restruck: number;
  peakVoices: number;
  scheduled: Map<string, number>;
}

export interface MixerOptions {
  /** offline renders clean voices up when they end, not with wall-clock timers */
  offline: boolean;
  quality: Quality;
  /** stems are rendered without the master limiter so they sum back to the mix */
  limiter?: boolean;
}

const RAMP = 0.03;
const HEADROOM = 0.2;

export class EnsembleMixer {
  readonly output: GainNode;
  readonly meter: AnalyserNode;
  private bus: GainNode;
  private headroom: GainNode;
  private limiter: DynamicsCompressorNode;
  private ceiling: WaveShaperNode;
  private dcBlock: BiquadFilterNode;
  private master: GainNode;
  private reverbIn: GainNode;
  private convolver: ConvolverNode;
  private reverbOut: GainNode;
  private delayIn: GainNode;
  private delayL: DelayNode;
  private delayR: DelayNode;
  private fbL: GainNode;
  private fbR: GainNode;
  private delayTone: BiquadFilterNode;
  private strips = new Map<string, Strip>();
  private voices: LiveVoice[] = [];
  private reverbKey = "";
  private generation = 0;
  private bpm = 120;
  readonly stats: MixerStats = { voicesStarted: 0, stolen: 0, restruck: 0, peakVoices: 0, scheduled: new Map() };
  quality: Quality;

  constructor(private ctx: BaseAudioContext, destination: AudioNode, private opts: MixerOptions) {
    this.quality = opts.quality;
    this.bus = ctx.createGain();
    this.headroom = ctx.createGain();
    this.limiter = ctx.createDynamicsCompressor();
    // A safety limiter, not a pump. DynamicsCompressorNode adds automatic makeup gain derived from
    // its curve at 0 dBFS; with the threshold at 0 dB and no knee that gain is exactly 1, so the
    // stage only touches overs. Slow release so low notes are not distorted inside a cycle.
    this.limiter.threshold.value = 0;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = opts.limiter === false ? 1 : 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;
    // the attack lets a transient's first milliseconds through: a soft ceiling catches them
    this.ceiling = ctx.createWaveShaper();
    this.ceiling.curve = ceilingCurve() as Float32Array<ArrayBuffer>;
    // no oversampling: its reconstruction filter would overshoot the ceiling it exists to keep
    this.ceiling.oversample = "none";
    // struck bars ring as decaying sines that start at zero phase, which carries a small DC; a
    // subsonic high-pass removes it (as any microphone chain would)
    this.dcBlock = ctx.createBiquadFilter();
    this.dcBlock.type = "highpass";
    this.dcBlock.frequency.value = 18;
    this.dcBlock.Q.value = 0.6;
    this.master = ctx.createGain();
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 1024;
    this.output = ctx.createGain();

    this.reverbIn = ctx.createGain();
    this.convolver = ctx.createConvolver();
    this.convolver.normalize = false;
    this.reverbOut = ctx.createGain();
    this.reverbIn.connect(this.convolver).connect(this.reverbOut).connect(this.headroom);

    this.delayIn = ctx.createGain();
    this.delayL = ctx.createDelay(4);
    this.delayR = ctx.createDelay(4);
    this.fbL = ctx.createGain();
    this.fbR = ctx.createGain();
    this.delayTone = ctx.createBiquadFilter();
    this.delayTone.type = "lowpass";
    this.delayTone.frequency.value = 4200;
    const merger = ctx.createChannelMerger(2);
    this.delayIn.connect(this.delayTone).connect(this.delayL);
    this.delayL.connect(this.fbL).connect(this.delayR);
    this.delayR.connect(this.fbR).connect(this.delayL);
    this.delayL.connect(merger, 0, 0);
    this.delayR.connect(merger, 0, 1);
    const delayOut = ctx.createGain();
    delayOut.gain.value = 0.7;
    merger.connect(delayOut).connect(this.headroom);

    this.bus.connect(this.headroom);
    this.headroom.connect(this.dcBlock).connect(this.master).connect(this.limiter).connect(this.ceiling).connect(this.meter).connect(this.output);
    this.output.connect(destination);
  }

  /** Build or update channel strips for a composition's tracks; removed tracks are torn down. */
  setComposition(c: Composition): void {
    this.bpm = c.plan.bpm;
    const ids = new Set(c.tracks.map((t) => t.id));
    for (const [id, s] of this.strips) {
      if (ids.has(id)) continue;
      this.teardown(s);
      this.strips.delete(id);
    }
    for (const t of c.tracks) this.updateTrack(t, c.tracks);
    this.setMaster(c.master, c.tracks.length);
  }

  private teardown(s: Strip): void {
    try {
      s.lfo?.stop();
      s.input.disconnect();
      s.fader.disconnect();
      s.reverb.disconnect();
      s.delay.disconnect();
    } catch {
      /* already gone */
    }
  }

  private strip(t: Track): Strip {
    let s = this.strips.get(t.id);
    if (s) return s;
    const ctx = this.ctx;
    const input = ctx.createGain();
    const motor = ctx.createGain();
    const pan = ctx.createStereoPanner();
    const fader = ctx.createGain();
    const reverb = ctx.createGain();
    const delay = ctx.createGain();
    input.connect(motor).connect(pan).connect(fader).connect(this.bus);
    fader.connect(reverb).connect(this.reverbIn);
    fader.connect(delay).connect(this.delayIn);
    s = { track: t, input, motor, lfo: null, lfoDepth: null, pan, fader, reverb, delay };
    this.strips.set(t.id, s);
    return s;
  }

  /** Apply a track's mix and motor settings (mute/solo resolved against the whole lineup). */
  updateTrack(t: Track, all: Track[]): void {
    const s = this.strip(t);
    s.track = t;
    const now = this.ctx.currentTime;
    const anySolo = all.some((x) => x.mix.solo);
    const audible = anySolo ? t.mix.solo : !t.mix.mute;
    s.fader.gain.setTargetAtTime(audible ? clamp(t.mix.gain, 0, 2) : 0, now, RAMP);
    s.pan.pan.setTargetAtTime(clamp(t.mix.pan, -1, 1), now, RAMP);
    s.reverb.gain.setTargetAtTime(clamp(t.mix.reverb, 0, 1), now, RAMP);
    s.delay.gain.setTargetAtTime(clamp(t.mix.delay, 0, 1) * 0.8, now, RAMP);
    const m = t.engine.motor;
    if (m.on && m.depth > 0.01) {
      if (!s.lfo) {
        s.lfo = this.ctx.createOscillator();
        s.lfoDepth = this.ctx.createGain();
        s.lfo.connect(s.lfoDepth).connect(s.motor.gain);
        s.lfo.start();
      }
      s.lfo.frequency.setTargetAtTime(motorHz(m.speed), now, 0.05);
      s.lfoDepth!.gain.setTargetAtTime(m.depth * 0.42, now, 0.05);
      s.motor.gain.setTargetAtTime(1 - m.depth * 0.42, now, 0.05);
    } else if (s.lfoDepth) {
      s.lfoDepth.gain.setTargetAtTime(0, now, 0.05);
      s.motor.gain.setTargetAtTime(1, now, 0.05);
    }
  }

  setMaster(m: MasterSettings, trackCount: number): void {
    const now = this.ctx.currentTime;
    // headroom shrinks gently as the ensemble grows (uncorrelated parts add in power); calibrated
    // by rendering every profile at 4–12 instruments so the soft ceiling stays idle (peaks below
    // −2.5 dBFS) with the mix around −16…−20 dBFS RMS
    this.headroom.gain.setTargetAtTime(HEADROOM / Math.sqrt(Math.max(1, trackCount / 4)), now, RAMP);
    this.master.gain.setTargetAtTime(clamp(m.gain, 0, 1.5), now, RAMP);
    this.reverbOut.gain.setTargetAtTime(1.1, now, RAMP);
    const key = `${m.reverbSize.toFixed(2)}:${m.reverbDecay.toFixed(2)}`;
    if (key !== this.reverbKey) {
      this.reverbKey = key;
      this.convolver.buffer = buildReverb(this.ctx, lerp(1.2, 5.5, m.reverbDecay), m.reverbSize);
    }
    const seconds = clamp((m.delayBeats * 60) / this.bpm, 0.05, 3.5);
    this.delayL.delayTime.setValueAtTime(seconds, now);
    this.delayR.delayTime.setValueAtTime(seconds, now);
    this.fbL.gain.setTargetAtTime(clamp(m.delayFeedback, 0, 0.8), now, RAMP);
    this.fbR.gain.setTargetAtTime(clamp(m.delayFeedback, 0, 0.8), now, RAMP);
  }

  /** Strike one note. `when` is in context seconds; `secondsPerBeat` converts its length. */
  playNote(t: Track, n: NoteEvent, when: number, secondsPerBeat: number): void {
    const s = this.strip(t);
    const budget = VOICE_BUDGET[this.quality];
    const instrument = getInstrument(t.instrumentId);
    // prune what has ended by now
    this.voices = this.voices.filter((v) => v.end > when - 0.01 && v.generation === this.generation);
    // the same bar struck again: the previous vibration is replaced (fast damp)
    for (const v of this.voices) {
      if (v.trackId === t.id && v.midi === n.midi && v.start < when - 1e-4 && v.end > when) {
        v.voice.stop(true, when, 0.025);
        v.end = when + 0.05;
        this.stats.restruck++;
      }
    }
    const activeHere = this.voices.filter((v) => v.trackId === t.id && v.end > when);
    if (activeHere.length >= budget.perTrack) this.steal(activeHere, when);
    const activeAll = this.voices.filter((v) => v.end > when);
    if (activeAll.length >= budget.global) this.steal(activeAll, when);

    const playNote = n.midi - instrument.registerOffset;
    const spread = clamp((n.midi - 72) / 30, -1, 1) * t.engine.stereo.voiceSpread * 0.5;
    const voice = new MalletVoice({
      ctx: this.ctx,
      destination: s.input,
      instrument,
      params: t.engine,
      note: playNote,
      velocity: n.vel,
      pitchBendSemitones: 0,
      hardnessBias: 0,
      panBase: spread,
      startTime: when,
      tailFactor: budget.tailFactor,
      cleanup: "ended",
      rand: seeded(n.id * 7919 + n.midi),
    });
    const lv: LiveVoice = { voice, trackId: t.id, midi: n.midi, start: when, end: voice.endTime, peak: n.vel, decay: Math.max(0.2, voice.endTime - when), generation: this.generation };
    if (dampsAtNoteEnd(t.damp, t.role, t.instrumentId)) {
      const off = when + n.dur * secondsPerBeat;
      if (off < lv.end) {
        voice.stop(true, off);
        lv.end = Math.min(lv.end, off + voice.chokeSeconds + 0.05);
      }
    }
    this.voices.push(lv);
    this.stats.voicesStarted++;
    const key = `${t.id}:${n.id}`;
    this.stats.scheduled.set(key, (this.stats.scheduled.get(key) ?? 0) + 1);
    this.stats.peakVoices = Math.max(this.stats.peakVoices, this.voices.filter((v) => v.end > when).length);
  }

  /** Steal the voice that is quietest at `when` (oldest relative to its own decay). */
  private steal(pool: LiveVoice[], when: number): void {
    let victim = pool[0];
    let best = Infinity;
    for (const v of pool) {
      const level = v.peak * Math.exp((-4 * (when - v.start)) / v.decay);
      if (level < best) {
        best = level;
        victim = v;
      }
    }
    if (!victim) return;
    victim.voice.stop(true, when, 0.03);
    victim.end = when + 0.05;
    this.stats.stolen++;
  }

  /** Damp everything now (stop, seek, regenerate): nothing keeps sounding, nothing scheduled starts. */
  stopAll(fade = 0.06): void {
    const now = this.ctx.currentTime;
    for (const v of this.voices) v.voice.stop(true, Math.max(now, Math.min(now, v.start)), fade);
    this.voices = [];
    this.generation++;
  }

  activeVoices(at = this.ctx.currentTime): number {
    return this.voices.filter((v) => v.end > at && v.start <= at + 0.5).length;
  }

  trackLevel(id: string): number {
    return this.strips.get(id)?.fader.gain.value ?? 0;
  }

  dispose(): void {
    this.stopAll(0.02);
    for (const s of this.strips.values()) this.teardown(s);
    this.strips.clear();
    try {
      this.output.disconnect();
    } catch {
      /* ignore */
    }
  }

  static instrumentLevel(id: string): number {
    return ensembleInfo(id).level;
  }
}

/** Linear to 0.75, then a smooth knee that never exceeds 0.95 (−0.45 dBFS). A WaveShaper maps its
 *  curve across inputs −1…+1 and holds the end values beyond, so anything louder lands at 0.95. */
function ceilingCurve(): Float32Array {
  const n = 4097;
  const c = new Float32Array(n);
  const k = 0.75;
  const top = 0.95;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= k ? a : k + (top - k) * Math.tanh((a - k) / (top - k));
    c[i] = Math.sign(x) * y;
  }
  return c;
}

function seeded(seed: number): () => number {
  let x = (seed >>> 0) || 1;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

/** A stereo reverb impulse: seeded noise under an exponential decay with frequency-dependent
 *  damping, cut where it reaches −90 dB, early reflections spread by `size`. Scaled to unit energy
 *  per channel (and used with normalize = false), so a send level means the same thing whatever the
 *  reverb's length — an unnormalised 4-second tail would otherwise add some 25 dB of gain. */
export function buildReverb(ctx: BaseAudioContext, rt60: number, size: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const tau = rt60 / Math.log(1000); // amplitude e-folding time for −60 dB at rt60
  const length = Math.min(Math.ceil(tau * Math.log(31623) * sr), Math.ceil(8 * sr)); // to −90 dB
  const pre = Math.floor((0.008 + size * 0.025) * sr);
  const buf = ctx.createBuffer(2, length + pre, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let x = 0x9e3779b9 ^ (ch * 0x85ebca6b);
    let lp = 0;
    for (let i = 0; i < length; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      const white = ((x >>> 0) / 4294967296) * 2 - 1;
      const t = i / sr;
      // darker as it decays: the lowpass coefficient falls with time
      const coef = lerp(0.6, 0.12, Math.min(1, t / rt60));
      lp += (white - lp) * coef;
      d[pre + i] = lp * Math.exp(-t / tau) * 0.5;
    }
    // a few early reflections
    for (let k = 1; k <= 6; k++) {
      const at = pre + Math.floor((k * (0.007 + size * 0.012) + ch * 0.0031) * sr);
      if (at < d.length) d[at] += 0.35 / k;
    }
    let energy = 0;
    for (let i = 0; i < d.length; i++) energy += d[i] * d[i];
    const scale = 1 / Math.sqrt(Math.max(1e-12, energy));
    for (let i = 0; i < d.length; i++) d[i] *= scale;
  }
  return buf;
}
