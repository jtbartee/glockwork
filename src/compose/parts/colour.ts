// COLOUR: atmospheric texture, rhythmic punctuation and the experimental voice.
//
// TEXTURE. Glockenspiels, crotales and bells are used sparingly, as colour: a sparkle answering the
// melody where it comes to rest at each phrase ending (the cadence note doubled high, or a short
// falling flourish of chord tones at higher intensity), and a single strike to open a section. In
// ambient music the same instruments write "constellations": sparse long-ringing chord tones and
// colour tones placed with a minimum spacing, so silence stays part of the texture.
//
// PUNCTUATION marks structure: the downbeat of a section, cadence points, and in intense passages a
// Euclidean accent pattern on the chord root and fifth.
//
// EXPERIMENTAL VOICE. An independent line on its own cycle (5, 7, 2.5 … beats against the bar), with
// a Euclidean rhythm that rotates each section and a small pitch-class set transformed each cycle
// (transposed a scale step, inverted on alternate cycles), each pitch class in a fixed register
// (registral invariance), so the line is pointillist but consistent.

import { slotAt, stablePcs } from "../../theory/context";
import { euclid, rotate } from "../../theory/rhythm";
import type { Beats } from "../../theory/types";
import type { Draft } from "../types";
import { degreeFrame, draft, mod12, type PartEnv, phraseEnd, phraseStart, place, playable, strength } from "./common";

export function writeTexture(env: PartEnv): Draft[] {
  if (env.profile.id === "ambient" || (env.profile.id === "experimental" && env.r.chance(0.5))) return constellation(env);
  const { sec, bb, ctx } = env;
  const out: Draft[] = [];
  const line = env.shared.carrierFull;
  const hiBand = (lo: number) => Math.max(lo, env.hi - 14);
  // a strike that opens a theme or climax section
  if ((sec.fn === "theme" || sec.fn === "climax" || sec.fn === "variation") && playable(env, env.start) && env.r.chance(0.6)) {
    const slot = slotAt(ctx, env.start);
    const pc = slot.chord.pcs.includes(mod12(slot.chord.rootPc + 7)) ? mod12(slot.chord.rootPc + 7) : slot.chord.rootPc;
    out.push(draft(env.start, bb * 2, place(pc, env.hi - 6, hiBand(env.lo), env.hi), 0.75, "texture-open"));
  }
  for (const ph of sec.phrases) {
    const ps = phraseStart(ph, bb);
    const pe = phraseEnd(ph, bb);
    // the moment the melody comes to rest (its cadence note), else the phrase's last downbeat
    const cad = [...line].reverse().find((n) => n.start >= ps - 1e-6 && n.start < pe - 1e-6 && n.tag === "cadence");
    let at = cad ? cad.start : pe - bb;
    // answer just after the melody lands, on the next beat, when there is room
    if (cad && at + 1 < pe - 0.25) at = Math.ceil(at + 0.5);
    if (!playable(env, at)) continue;
    const slot = slotAt(ctx, at);
    const target = cad ? mod12(cad.midi) : stablePcs(slot)[0];
    const top = place(target, env.hi - 4, hiBand(env.lo), env.hi);
    if (sec.intensity > 0.6 && at + 0.75 < pe) {
      // a falling flourish of chord tones that lands on the cadence pitch
      const tones = stablePcs(slot).filter((pc) => pc !== target);
      const a = place(tones[0] ?? target, top + 5, top + 1, Math.min(env.hi, top + 9));
      const b = place(tones[1] ?? tones[0] ?? target, top + 2, top + 1, Math.min(env.hi, top + 7));
      const notes = [a, b].filter((m) => m > top && m <= env.hi);
      const step = env.bpm > 110 ? 0.5 : 0.25;
      notes.sort((x, y) => y - x).forEach((m, i) => out.push(draft(at + i * step, step * 2, m, 0.6, "texture-flourish")));
      out.push(draft(at + notes.length * step, Math.max(bb, pe - at), top, 0.72, "texture-answer"));
    } else out.push(draft(at, Math.max(bb, pe - at), top, 0.7, "texture-answer"));
  }
  return out;
}

function constellation(env: PartEnv): Draft[] {
  const { sec, bb, ctx, controls } = env;
  const out: Draft[] = [];
  const bars = (env.end - env.start) / bb;
  const expected = Math.max(1, bars * (0.35 + controls.density * 0.6) * (0.4 + sec.intensity));
  const minGap = Math.max(1.5, bb * (1.2 - controls.density * 0.6));
  let t = env.start + env.r() * bb;
  let last: number | undefined;
  while (t < env.end - 0.5 && out.length < expected * 1.6) {
    if (playable(env, t)) {
      const slot = slotAt(ctx, t);
      const colour = ctx.characteristic.filter((pc) => ctx.pcs.includes(pc));
      const pool = [...stablePcs(slot), ...colour, ...(slot.chord.pcs.length > 3 ? slot.chord.pcs.slice(3) : [])];
      const pc = env.r.pick(pool);
      const near = last !== undefined ? last + env.r.pick([-5, -3, 3, 5, 7]) : (env.lo + env.hi) / 2 + 4;
      const m = place(pc, near, env.lo, env.hi);
      const quant = Math.round(t * 2) / 2;
      out.push(draft(quant, bb * (1.5 + env.r() * 1.5), m, 0.5 + env.r() * 0.25, "texture-constellation"));
      if (env.r.chance(0.18)) out.push(draft(quant, bb * 2, place(stablePcs(slot)[1] ?? pc, m - 4, env.lo, m - 1), 0.45, "texture-constellation"));
      last = m;
    }
    const meanGap = (bars * bb) / expected;
    t += Math.max(minGap, meanGap * (0.5 + env.r()));
  }
  return out;
}

export function writePunctuation(env: PartEnv): Draft[] {
  const { sec, bb, ctx } = env;
  const out: Draft[] = [];
  const low = (pc: number) => place(pc, env.lo + 5, env.lo, Math.min(env.hi, env.lo + 14));
  if (playable(env, env.start) && sec.fn !== "intro") out.push(draft(env.start, bb, low(slotAt(ctx, env.start).chord.rootPc), 1, "punct-downbeat"));
  for (const ph of sec.phrases) {
    const pe = phraseEnd(ph, bb);
    const at = pe - bb;
    if (!playable(env, at) || at <= env.start + 1e-6) continue;
    const slot = slotAt(ctx, at);
    const pc = ph.cadence === "full" ? slot.chord.rootPc : stablePcs(slot).find((x) => x !== slot.chord.rootPc) ?? slot.chord.rootPc;
    out.push(draft(at, bb, low(pc), ph.cadence === "full" ? 0.95 : 0.8, `punct-${ph.cadence}`));
  }
  if (sec.intensity >= 0.6) {
    const steps = Math.max(2, Math.round(bb / 0.5));
    const k = Math.max(2, Math.min(steps - 1, Math.round(steps * (0.25 + 0.2 * env.controls.rhythmicComplexity))));
    const pat = rotate(euclid(k, steps), sec.index % steps);
    for (let bar = env.start; bar < env.end - 1e-6; bar += bb) {
      const slot = slotAt(ctx, bar);
      pat.forEach((on, i) => {
        const at = bar + i * 0.5;
        if (!on || i === 0 || !playable(env, at) || out.some((n) => Math.abs(n.start - at) < 0.26)) return;
        const other = stablePcs(slot).find((x) => x !== slot.chord.rootPc) ?? slot.chord.rootPc;
        out.push(draft(at, 0.5, low(i % 2 ? other : slot.chord.rootPc), 0.62, "punct-euclid"));
      });
    }
  }
  return out;
}

export function writeExperimental(env: PartEnv): Draft[] {
  const { sec, bb, ctx, controls, r } = env;
  const f = degreeFrame(env);
  const options: Beats[] = [2.5, 3.5, 5, 7, 4.5, 3].filter((x) => Math.abs(x - bb) > 1e-6);
  const cycle = r.pick(options);
  const steps = Math.round(cycle * 2);
  const k = Math.max(2, Math.min(steps - 1, Math.round(steps * (0.3 + controls.density * 0.25))));
  const pat = rotate(euclid(k, steps), sec.index * 2 + r.int(0, 2));
  const set = [0, r.pick([1, 2]), r.pick([3, 4]), r.pick([5, 6])].slice(0, r.chance(0.5) ? 3 : 4);
  // registral invariance: every pitch class of the set keeps one register for the section
  const reg = new Map<number, number>();
  const out: Draft[] = [];
  let c = 0;
  for (let t = env.start; t < env.end - 1e-6; t += cycle, c++) {
    const inv = c % 2 === 1 && r.chance(0.5 + controls.motifVariation * 0.4);
    const tr = Math.floor(c / 2);
    const degs = set.map((d) => (inv ? -d : d) + tr);
    let i = 0;
    pat.forEach((on, s) => {
      const at = t + s * 0.5;
      if (!on || at >= env.end - 1e-6 || !playable(env, at)) return;
      const d = degs[i++ % degs.length];
      const pcKey = mod12(f.toMidi(d));
      let m = reg.get(pcKey);
      if (m === undefined) {
        const span = env.hi - env.lo;
        m = place(pcKey, env.lo + span * (0.15 + 0.7 * r()), env.lo, env.hi);
        reg.set(pcKey, m);
      }
      // controlled dissonance: a chromatic neighbour only on weak positions, within the budget
      if (ctx.behavior === "experimental" && strength(env, at) < 0.5 && r.chance(controls.dissonance * 0.3)) m += r.pick([-1, 1]);
      out.push(draft(at, 0.5 * (1 + r.int(0, 2)), m, strength(env, at) >= 0.75 ? 0.75 : 0.6, `experimental-cycle${cycle}`));
    });
  }
  return out;
}
