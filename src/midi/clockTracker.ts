import { clamp } from "../utils/math";

/** Turns a stream of incoming MIDI clock pulse timestamps (24 per quarter note) into a
 * smoothed BPM estimate using a short moving average. */
export class MidiClockTracker {
  private tickTimes: number[] = [];

  onTick(timestampMs: number): number | null {
    this.tickTimes.push(timestampMs);
    if (this.tickTimes.length > 24) this.tickTimes.shift();
    if (this.tickTimes.length < 4) return null;
    let totalDelta = 0;
    for (let i = 1; i < this.tickTimes.length; i++) totalDelta += this.tickTimes[i] - this.tickTimes[i - 1];
    const avgDeltaMs = totalDelta / (this.tickTimes.length - 1);
    if (avgDeltaMs <= 0) return null;
    const quarterNoteMs = avgDeltaMs * 24;
    return clamp(60000 / quarterNoteMs, 20, 300);
  }

  reset(): void {
    this.tickTimes = [];
  }
}
