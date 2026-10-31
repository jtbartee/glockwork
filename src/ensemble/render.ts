// OFFLINE RENDER. The same mixer and voices in an OfflineAudioContext. Notes are scheduled in short
// chunks at suspend() points as rendering advances, so a 256-bar piece never builds tens of
// thousands of voices up front; the suspend points also report progress and allow cancelling.

import type { Beats, Composition } from "../compose/types";
import { barBeats } from "../theory/meter";
import { EnsembleMixer, type Quality } from "./mixer";
import { dueIn } from "./schedule";

export interface RenderOptions {
  fromBeat?: Beats;
  toBeat?: Beats;
  /** render only these tracks (a stem); others are silent */
  trackIds?: string[];
  sampleRate?: number;
  tailSeconds?: number;
  quality?: Quality;
  limiter?: boolean;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

const CHUNK = 2;

export async function renderComposition(c: Composition, o: RenderOptions = {}): Promise<AudioBuffer> {
  const sr = o.sampleRate ?? 48000;
  const bb = barBeats(c.plan.meter);
  const from = o.fromBeat ?? 0;
  const to = o.toBeat ?? c.plan.bars * bb;
  const spb = 60 / c.plan.bpm;
  const duration = (to - from) * spb + (o.tailSeconds ?? 4);
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * sr), sr);
  const tracks = o.trackIds ? c.tracks.map((t) => ({ ...t, mix: { ...t.mix, mute: false, solo: o.trackIds!.includes(t.id) } })) : c.tracks;
  const comp = { ...c, tracks };
  const mixer = new EnsembleMixer(ctx, ctx.destination, { offline: true, quality: o.quality ?? "high", limiter: o.limiter });
  mixer.setComposition(comp);
  const audible = tracks.filter((t) => (tracks.some((x) => x.mix.solo) ? t.mix.solo : !t.mix.mute));
  const schedule = (t0: number) => {
    const b0 = from + t0 / spb;
    const b1 = Math.min(to, from + (t0 + CHUNK) / spb);
    for (const d of dueIn(audible, b0, b1)) mixer.playNote(d.track, d.note, (d.beat - from) * spb, spb);
  };
  schedule(0);
  let cancelled = false;
  for (let t = CHUNK; t < duration; t += CHUNK) {
    const at = t;
    void ctx.suspend(at).then(() => {
      if (o.signal?.aborted) cancelled = true;
      if (!cancelled) schedule(at);
      o.onProgress?.(Math.min(1, at / duration));
      return ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  if (cancelled) throw new DOMException("Render cancelled", "AbortError");
  o.onProgress?.(1);
  return buf;
}

/** One buffer per track (rendered without the master limiter so they sum back to the mix). */
export async function renderStems(c: Composition, o: RenderOptions = {}): Promise<{ trackId: string; name: string; buffer: AudioBuffer }[]> {
  const out: { trackId: string; name: string; buffer: AudioBuffer }[] = [];
  const list = c.tracks.filter((t) => t.notes.length);
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const buffer = await renderComposition(c, { ...o, trackIds: [t.id], limiter: false, onProgress: (f) => o.onProgress?.((i + f) / list.length) });
    out.push({ trackId: t.id, name: t.name, buffer });
  }
  return out;
}

export interface AudioAudit {
  peak: number;
  peakDb: number;
  rms: number;
  rmsDb: number;
  /** share of samples within 0.5 dB of full scale */
  nearCeiling: number;
  /** share of samples above 0.75 (−2.5 dBFS), where the mixer's soft ceiling starts to bend */
  overKnee: number;
  /** DC offset */
  dc: number;
  /** isolated discontinuities (≥4× every spike 0.7–6 ms away, ≥12× local level) */
  clicks: number;
  /** longest run of digital silence inside the music, seconds */
  longestSilence: number;
  nonFinite: number;
}

/** Measurements of a rendered buffer: level, clipping, DC, isolated clicks, silent gaps. The click
 *  test follows the APERTURE audit: a spike in the second difference counts only when it towers
 *  over the local signal and over every other spike nearby (periodic bright waveforms are not clicks). */
export function auditBuffer(buf: AudioBuffer, musicEndSec = buf.duration): AudioAudit {
  const sr = buf.sampleRate;
  let peak = 0;
  let sum = 0;
  let near = 0;
  let knee = 0;
  let dcSum = 0;
  let nonFinite = 0;
  let clicks = 0;
  let longest = 0;
  const ceiling = Math.pow(10, -0.5 / 20);
  const n = buf.length;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const x = buf.getChannelData(ch);
    const d2 = new Float32Array(n);
    let run = 0;
    for (let i = 0; i < n; i++) {
      const v = x[i];
      if (!Number.isFinite(v)) {
        nonFinite++;
        continue;
      }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      if (a >= ceiling) near++;
      if (a > 0.75) knee++;
      sum += v * v;
      dcSum += v;
      if (i >= 2) d2[i] = Math.abs(v - 2 * x[i - 1] + x[i - 2]);
      if (i / sr < musicEndSec) {
        if (a < 1e-7) run++;
        else {
          longest = Math.max(longest, run / sr);
          run = 0;
        }
      }
    }
    const w = 256;
    const iso0 = Math.round(0.0007 * sr);
    const iso1 = Math.round(0.006 * sr);
    for (let i = w; i < n - w; i++) {
      const s = d2[i];
      if (s < 0.02) continue;
      let local = 0;
      for (let k = i - w; k < i + w; k += 8) local += Math.abs(x[k]);
      local /= (2 * w) / 8;
      if (s < 12 * local) continue;
      let isolated = true;
      for (let k = i - iso1; k <= i + iso1 && isolated; k++) if (Math.abs(k - i) >= iso0 && d2[k] * 4 > s) isolated = false;
      if (isolated) clicks++;
      i += iso1;
    }
  }
  const total = n * buf.numberOfChannels;
  const rms = Math.sqrt(sum / Math.max(1, total));
  return {
    peak, peakDb: 20 * Math.log10(Math.max(1e-9, peak)), rms, rmsDb: 20 * Math.log10(Math.max(1e-9, rms)),
    nearCeiling: near / Math.max(1, total), overKnee: knee / Math.max(1, total), dc: dcSum / Math.max(1, total), clicks, longestSilence: longest, nonFinite,
  };
}
