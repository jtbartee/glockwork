import type { AudioEngine } from "./engine";
import { ARP_RATES, rateToSeconds, type ArpRate } from "./timing";
import { getScale, quantizeToScale } from "./scales";
import { clamp } from "../utils/math";
import { Emitter } from "../utils/events";

export type ArpPattern = "up" | "down" | "up-down" | "down-up" | "played" | "random" | "chord";

export const ARP_PATTERNS: ArpPattern[] = ["up", "down", "up-down", "down-up", "played", "random", "chord"];

export interface ArpParams {
  on: boolean;
  latch: boolean;
  rate: ArpRate;
  pattern: ArpPattern;
  octaveRange: number;
  gateLength: number;
  letRing: boolean;
  swing: number;
  velocity: number;
  velocityVariation: number;
  probability: number;
  humanize: number;
  useScaleLock: boolean;
}

export function defaultArpParams(): ArpParams {
  return {
    on: false,
    latch: false,
    rate: "1/8",
    pattern: "up",
    octaveRange: 1,
    gateLength: 0.6,
    letRing: false,
    swing: 0,
    velocity: 0.8,
    velocityVariation: 0.15,
    probability: 1,
    humanize: 0.05,
    useScaleLock: true,
  };
}

export { ARP_RATES };

interface OrffScaleState {
  enabled: boolean;
  root: number;
  scaleId: string;
}

interface ArpDeps {
  getBpm: () => number;
  getOrffScale: () => OrffScaleState;
  getClockRunning: () => boolean;
}

interface ArpEvents {
  step: { note: number; velocity: number; time: number };
  [key: string]: unknown;
}

const SCHEDULE_AHEAD = 0.12;
const TICK_MS = 25;

/** Lookahead-scheduled arpeggiator. Ticks are driven by an AudioWorklet clock (falling back to
 * a timer if worklets are unavailable) but every note-on/off is booked at a precise
 * AudioContext time, so playback stays tight regardless of main-thread jitter. */
export class Arpeggiator {
  readonly events = new Emitter<ArpEvents>();
  private params: ArpParams = defaultArpParams();
  private liveHeld = new Set<number>();
  private orderPlayed: number[] = [];
  private latchedNotes: number[] = [];
  private running = false;
  private wasClockRunning = true;
  private nextStepTime = 0;
  private stepIndex = 0;
  private clockNode: AudioWorkletNode | null = null;
  private fallbackTimer: number | null = null;
  private clockReady: Promise<void> | null = null;

  constructor(private ctx: AudioContext, private engine: AudioEngine, private deps: ArpDeps) {}

  getParams(): ArpParams {
    return this.params;
  }

  setParams(params: ArpParams): void {
    const turningOn = params.on && !this.params.on;
    const turningOff = !params.on && this.params.on;
    const latchTurnedOff = !params.latch && this.params.latch;
    this.params = params;
    if (latchTurnedOff) this.latchedNotes = [];
    if (turningOn) this.start();
    if (turningOff) this.stop();
  }

  noteHeld(note: number, down: boolean): void {
    if (down) {
      if (this.params.latch && this.liveHeld.size === 0) this.latchedNotes = [];
      this.liveHeld.add(note);
      if (!this.orderPlayed.includes(note)) this.orderPlayed.push(note);
      if (this.params.latch && !this.latchedNotes.includes(note)) this.latchedNotes.push(note);
    } else {
      this.liveHeld.delete(note);
      this.orderPlayed = this.orderPlayed.filter((n) => n !== note);
    }
  }

  clearHeld(): void {
    this.liveHeld.clear();
    this.orderPlayed = [];
    this.latchedNotes = [];
  }

  isRunning(): boolean {
    return this.running;
  }

  private effectiveNotes(): number[] {
    return this.params.latch ? this.latchedNotes.slice() : this.orderPlayed.slice();
  }

  private async start(): Promise<void> {
    this.running = true;
    this.stepIndex = 0;
    this.nextStepTime = this.ctx.currentTime + 0.05;
    this.wasClockRunning = this.deps.getClockRunning();
    await this.ensureClock();
  }

  private stop(): void {
    this.running = false;
  }

  private async ensureClock(): Promise<void> {
    if (this.clockNode || this.fallbackTimer !== null) return;
    if (!this.clockReady) this.clockReady = this.setupClock();
    await this.clockReady;
  }

  private async setupClock(): Promise<void> {
    try {
      const base = import.meta.env.BASE_URL ?? "/";
      await this.ctx.audioWorklet.addModule(`${base}worklets/clock-processor.js`);
      const node = new AudioWorkletNode(this.ctx, "clock-processor", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      node.port.onmessage = () => this.tick();
      node.connect(this.ctx.destination);
      this.clockNode = node;
    } catch (err) {
      console.warn("[glockwork] Clock AudioWorklet unavailable, using timer fallback for the arpeggiator.", err);
      this.fallbackTimer = window.setInterval(() => this.tick(), TICK_MS);
    }
  }

  private tick(): void {
    if (!this.running) return;
    const clockRunning = this.deps.getClockRunning();
    if (clockRunning && !this.wasClockRunning) {
      this.nextStepTime = this.ctx.currentTime + 0.05;
      this.stepIndex = 0;
    }
    this.wasClockRunning = clockRunning;
    if (!clockRunning) return;

    while (this.nextStepTime < this.ctx.currentTime + SCHEDULE_AHEAD) {
      const stepSeconds = rateToSeconds(this.params.rate, this.deps.getBpm());
      this.scheduleStep(this.stepIndex, this.nextStepTime, stepSeconds);
      this.nextStepTime += stepSeconds;
      this.stepIndex++;
    }
  }

  private scheduleStep(stepIndex: number, time: number, stepSeconds: number): void {
    const sequence = this.buildSequence();
    if (sequence.length === 0) return;
    const isOdd = stepIndex % 2 === 1;
    const swungTime = time + (isOdd ? this.params.swing * stepSeconds * 0.5 : 0) + (Math.random() * 2 - 1) * this.params.humanize * 0.02;

    if (this.params.pattern === "chord") {
      for (const note of sequence) this.triggerNote(note, swungTime, stepSeconds);
      return;
    }
    const note =
      this.params.pattern === "random"
        ? sequence[Math.floor(Math.random() * sequence.length)]
        : sequence[((stepIndex % sequence.length) + sequence.length) % sequence.length];
    this.triggerNote(note, swungTime, stepSeconds);
  }

  private triggerNote(rawNote: number, time: number, stepSeconds: number): void {
    if (Math.random() > this.params.probability) return;
    const orff = this.deps.getOrffScale();
    const note = this.params.useScaleLock && orff.enabled ? quantizeToScale(rawNote, orff.root, getScale(orff.scaleId)) : rawNote;
    const velocity = clamp(this.params.velocity + (Math.random() * 2 - 1) * this.params.velocityVariation, 0.05, 1);
    const id = this.engine.noteOn(note, velocity, true, time);
    this.events.emit("step", { note, velocity, time });
    if (!this.params.letRing) {
      const gateSeconds = Math.max(0.02, stepSeconds * clamp(this.params.gateLength, 0.05, 1));
      const delayMs = Math.max(0, time - this.ctx.currentTime + gateSeconds) * 1000;
      window.setTimeout(() => this.engine.releaseVoice(id), delayMs);
    }
  }

  private buildSequence(): number[] {
    const base = this.effectiveNotes();
    if (base.length === 0) return [];
    const octaves = Math.round(clamp(this.params.octaveRange, 1, 4));
    const ascending = base.slice().sort((a, b) => a - b);

    const expandAscending = (): number[] => {
      const out: number[] = [];
      for (let o = 0; o < octaves; o++) for (const n of ascending) out.push(n + 12 * o);
      return out.sort((a, b) => a - b);
    };

    switch (this.params.pattern) {
      case "up":
        return expandAscending();
      case "down":
        return expandAscending().reverse();
      case "up-down": {
        const up = expandAscending();
        const down = up.slice(1, -1).reverse();
        return up.concat(down);
      }
      case "down-up": {
        const down = expandAscending().reverse();
        const up = down.slice(1, -1).reverse();
        return down.concat(up);
      }
      case "played": {
        const out: number[] = [];
        for (let o = 0; o < octaves; o++) for (const n of base) out.push(n + 12 * o);
        return out;
      }
      case "random":
      case "chord":
      default:
        return expandAscending();
    }
  }

  dispose(): void {
    this.stop();
    if (this.fallbackTimer !== null) window.clearInterval(this.fallbackTimer);
    if (this.clockNode) this.clockNode.port.onmessage = null;
  }
}
