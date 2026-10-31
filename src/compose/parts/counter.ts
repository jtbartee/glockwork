// COUNTER-MELODY. An independent line written against the carrier.
//
// Rhythm: complementary — the counter-melody moves where the melody holds or rests and holds where
// the melody is busy, so the two lines interlock instead of moving in lockstep.
// Pitch: a dynamic-programming search (solveLine) over the scale tones in range, scoring
//   vertical intervals with the melody (thirds and sixths best, fifths and octaves acceptable,
//   seconds/sevenths/tritones only on weak positions), chord tones on strong beats, register
//   (below the melody, near the middle of the part's range), and motion (steps preferred, leaps
//   costed, repeated notes discouraged, parallel fifths and octaves with the melody forbidden,
//   contrary motion rewarded). The counterpoint control raises independence (more onsets).
// Without a carrier in the section it writes a slow second line over the harmony instead.

import { slotAt, stablePcs } from "../../theory/context";
import { scalePitches } from "../../theory/scales";
import type { Beats } from "../../theory/types";
import type { Draft } from "../types";
import { draft, mod12, type PartEnv, phraseAt, phraseEnd, playable, solveLine, soundingAt, strength } from "./common";

export function writeCounter(env: PartEnv): Draft[] {
  const { sec, bb, ctx, controls } = env;
  const line = env.shared.carrierLine;
  const g: Beats = controls.counterpoint > 0.65 || bb % 1 !== 0 ? 0.5 : 1;
  const onsets: { beat: Beats; dur: Beats }[] = [];
  const carrierOn = new Set(line.map((n) => Math.round(n.start / 0.25)));
  const r = env.r;
  for (let t = env.start; t < env.end - 1e-6; t += g) {
    if (!playable(env, t)) continue;
    const w = strength(env, t);
    const m = soundingAt(line, t);
    const melodyStrikes = carrierOn.has(Math.round(t / 0.25));
    const melodyHolds = m && !melodyStrikes;
    const resting = !m;
    let p = 0.12 + controls.counterpoint * 0.25;
    if (melodyHolds) p += 0.45;
    if (resting) p += line.length ? 0.4 : 0.15;
    if (melodyStrikes && w < 0.75) p -= 0.15;
    if (w >= 0.75) p += 0.15;
    // phrase endings: the counter line arrives with the cadence
    const { phrase } = phraseAt(sec, bb, t);
    if (Math.abs(t - (phraseEnd(phrase, bb) - bb)) < 1e-6) p = 1;
    if (r.chance(Math.max(0.05, Math.min(1, p)))) onsets.push({ beat: t, dur: g });
  }
  if (!onsets.length) return [];
  for (let i = 0; i < onsets.length; i++) {
    const next = onsets[i + 1]?.beat ?? env.end;
    const { phrase } = phraseAt(sec, bb, onsets[i].beat);
    onsets[i].dur = Math.max(g, Math.min(next, phraseEnd(phrase, bb)) - onsets[i].beat);
  }

  const pitches = scalePitches(ctx.key, ctx.scale, env.lo, env.hi, ctx.custom);
  const centre = (env.lo + env.hi) / 2;
  const melAt = onsets.map((o) => soundingAt(line, o.beat)?.midi);
  const solved = solveLine({
    count: onsets.length,
    candidates: () => pitches,
    local: (i, m) => {
      const o = onsets[i];
      const w = strength(env, o.beat);
      const slot = slotAt(ctx, o.beat);
      let c = Math.abs(m - centre) * 0.06;
      const mel = melAt[i];
      if (mel !== undefined) {
        const ic = mod12(mel - m);
        const below = m < mel;
        if (!below) c += 1.2; // stay below the melody (crossing is allowed but costs)
        if (Math.abs(mel - m) < 3) c += 1.5;
        c += ic === 3 || ic === 4 || ic === 8 || ic === 9 ? 0 : ic === 7 ? 0.35 : ic === 0 ? 0.9 : ic === 5 ? 0.8 : ic === 1 || ic === 11 ? (w >= 0.5 ? 6 : 2) : ic === 2 || ic === 10 ? (w >= 0.5 ? 2 : 0.6) : 2.5;
      }
      const ct = slot.chord.pcs.includes(mod12(m));
      if (!ct && w >= 0.5) c += ctx.behavior === "strict" ? 2.2 : 1;
      if (stablePcs(slot).includes(mod12(m)) && o.dur >= bb) c -= 0.3;
      return c;
    },
    transition: (i, a, b) => {
      const d = Math.abs(b - a);
      let c = d === 0 ? 0.9 : d <= 2 ? 0 : d <= 4 ? 0.35 : d <= 7 ? 0.9 : 2.2;
      const m0 = melAt[i - 1];
      const m1 = melAt[i];
      if (m0 !== undefined && m1 !== undefined) {
        const iv0 = mod12(m0 - a);
        const iv1 = mod12(m1 - b);
        const sameDir = Math.sign(m1 - m0) === Math.sign(b - a) && m1 !== m0;
        if (sameDir && (iv1 === 7 || iv1 === 0) && iv0 === iv1) c += 4; // parallel fifths / octaves
        if (Math.sign(m1 - m0) === -Math.sign(b - a) && m1 !== m0) c -= 0.25; // contrary motion
      }
      return c;
    },
  });
  return onsets.map((o, i) => draft(o.beat, o.dur, solved[i], strength(env, o.beat) >= 0.75 ? 0.72 : 0.6, "counter"));
}
