// SCHEDULING CORE (pure). Which notes start inside a window of beats, across all tracks, honouring a
// loop region. Shared by the live transport and the offline renderer, and unit-tested without audio.

import type { Beats, NoteEvent, Track } from "../compose/types";

export interface Due {
  track: Track;
  note: NoteEvent;
  /** the beat the note sounds at in this pass (its own start, shifted for loop repetitions) */
  beat: Beats;
}

/** First index in a start-sorted note list whose start is ≥ beat. */
export function lowerBound(notes: NoteEvent[], beat: Beats): number {
  let lo = 0;
  let hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (notes[mid].start < beat - 1e-9) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Notes starting in [from, to) of every track. */
export function dueIn(tracks: Track[], from: Beats, to: Beats): Due[] {
  const out: Due[] = [];
  if (to <= from) return out;
  for (const t of tracks) {
    const ns = t.notes;
    for (let i = lowerBound(ns, from); i < ns.length && ns[i].start < to - 1e-9; i++) out.push({ track: t, note: ns[i], beat: ns[i].start });
  }
  out.sort((a, b) => a.beat - b.beat);
  return out;
}

export interface LoopRegion {
  on: boolean;
  start: Beats;
  end: Beats;
}

/** Map a stretch of continuous playback time onto the piece with a loop: returns the piece windows
 *  [from, to) it covers and the playback offset at which each begins. */
export function loopWindows(cursor: Beats, length: Beats, loop: LoopRegion | null): { from: Beats; to: Beats; offset: Beats }[] {
  const out: { from: Beats; to: Beats; offset: Beats }[] = [];
  if (!loop?.on || loop.end - loop.start <= 1e-6) {
    out.push({ from: cursor, to: cursor + length, offset: 0 });
    return out;
  }
  let pos = cursor;
  let left = length;
  let offset = 0;
  let guard = 0;
  while (left > 1e-9 && guard++ < 64) {
    if (pos >= loop.end - 1e-9) pos = loop.start;
    const span = Math.min(left, loop.end - pos);
    out.push({ from: pos, to: pos + span, offset });
    offset += span;
    left -= span;
    pos += span;
  }
  return out;
}

/** Wrap a position into the loop region (where playback actually is). */
export function wrapLoop(beat: Beats, loop: LoopRegion | null): Beats {
  if (!loop?.on || loop.end - loop.start <= 1e-6 || beat < loop.end) return beat;
  return loop.start + ((beat - loop.start) % (loop.end - loop.start));
}
