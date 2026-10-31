// LIVE TRANSPORT. One clock for every track. A lookahead scheduler, ticked by GLOCKWORK's clock
// AudioWorklet (or a timer where worklets are unavailable), books every strike at a precise
// AudioContext time a little ahead of the audio thread. Notes are read from the composition's
// arrays on every tick, so edits made during playback are heard on their next pass. A generation
// token makes stop, seek and regeneration atomic: ticks from an old run never schedule anything.

import type { Beats, Composition } from "../compose/types";
import type { EnsembleMixer } from "./mixer";
import { dueIn, loopWindows, type LoopRegion, wrapLoop } from "./schedule";

const TICK_MS = 25;

export interface TransportHooks {
  /** called before each scheduling pass: the endless performer writes more music here */
  beforeSchedule?: (untilBeat: Beats) => void;
  onEnd?: () => void;
}

export class EnsembleTransport {
  private composition: Composition | null = null;
  private playing = false;
  private generation = 0;
  /** piece position (beats) at the time `anchorTime`, before loop wrapping */
  private anchorBeat = 0;
  private anchorTime = 0;
  /** continuous beats scheduled so far, relative to the anchor */
  private scheduledTo = 0;
  private loop: LoopRegion | null = null;
  private clockNode: AudioWorkletNode | null = null;
  private timer: number | null = null;
  private clockReady: Promise<void> | null = null;
  lookahead = 0.18;
  endless = false;

  constructor(private ctx: AudioContext, private mixer: EnsembleMixer, private hooks: TransportHooks = {}) {}

  setComposition(c: Composition | null): void {
    this.composition = c;
  }

  setLoop(loop: LoopRegion | null): void {
    // re-anchor so the current position is kept and the new region applies from here on
    if (this.playing) {
      const pos = this.position();
      this.restartAt(pos);
    }
    this.loop = loop;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  private spb(): number {
    return 60 / (this.composition?.plan.bpm ?? 120);
  }

  private pieceBeats(): Beats {
    const c = this.composition;
    if (!c) return 0;
    const bb = c.plan.meter ? barBeatsOf(c) : 4;
    return this.endless ? Infinity : c.plan.bars * bb;
  }

  /** Current musical position (beats into the piece), as heard (output latency compensated). */
  position(): Beats {
    if (!this.playing) return this.anchorBeat;
    const latency = (this.ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0;
    const elapsed = Math.max(0, this.ctx.currentTime - latency - this.anchorTime) / this.spb();
    return wrapLoop(this.anchorBeat + elapsed, this.loop);
  }

  async play(from: Beats = this.anchorBeat): Promise<void> {
    if (!this.composition) return;
    if (this.ctx.state !== "running") await this.ctx.resume();
    await this.ensureClock();
    this.restartAt(from);
    this.playing = true;
    this.tick();
  }

  private restartAt(from: Beats): void {
    this.generation++;
    this.mixer.stopAll();
    this.anchorBeat = Math.max(0, from);
    this.anchorTime = this.ctx.currentTime + 0.06;
    this.scheduledTo = 0;
  }

  stop(): void {
    const pos = this.position();
    this.generation++;
    this.playing = false;
    this.mixer.stopAll();
    this.anchorBeat = pos;
  }

  /** Move the playhead; playback continues from there if running. */
  seek(beat: Beats): void {
    if (this.playing) {
      this.restartAt(beat);
      this.tick();
    } else this.anchorBeat = Math.max(0, beat);
  }

  private async ensureClock(): Promise<void> {
    if (this.clockNode || this.timer !== null) return;
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
      console.warn("[glockwork] Clock AudioWorklet unavailable, using a timer for the ensemble transport.", err);
      this.timer = window.setInterval(() => this.tick(), TICK_MS);
    }
  }

  private tick(): void {
    const c = this.composition;
    if (!this.playing || !c) return;
    const gen = this.generation;
    const spb = this.spb();
    const horizon = this.ctx.currentTime + this.lookahead - this.anchorTime;
    const until = horizon / spb;
    if (until <= this.scheduledTo) return;
    const length = until - this.scheduledTo;
    const startCursor = wrapLoop(this.anchorBeat + this.scheduledTo, this.loop);
    this.hooks.beforeSchedule?.(startCursor + length + 1);
    if (gen !== this.generation) return;
    const end = this.pieceBeats();
    for (const w of loopWindows(startCursor, length, this.loop)) {
      const to = Math.min(w.to, end + 1e-6);
      for (const d of dueIn(c.tracks, w.from, to)) {
        const when = this.anchorTime + (this.scheduledTo + w.offset + (d.beat - w.from)) * spb;
        if (when < this.ctx.currentTime - 0.005) continue;
        this.mixer.playNote(d.track, d.note, when, spb);
      }
    }
    this.scheduledTo = until;
    // the piece ran out (no loop): stop once its last notes have rung for four seconds
    if (!this.loop?.on && !this.endless) {
      const heard = this.anchorBeat + (this.ctx.currentTime - this.anchorTime) / spb;
      if (heard > end + 4 / spb) {
        this.playing = false;
        this.anchorBeat = 0;
        this.hooks.onEnd?.();
      }
    }
  }

  dispose(): void {
    this.stop();
    if (this.timer !== null) window.clearInterval(this.timer);
    if (this.clockNode) {
      this.clockNode.port.onmessage = null;
      this.clockNode.disconnect();
    }
  }
}

function barBeatsOf(c: Composition): number {
  const [num, den] = c.plan.meter.split("/").map(Number);
  return (num * 4) / den;
}
