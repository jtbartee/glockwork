// ACCOMPANIMENT: bordun, bass foundation, harmony and arpeggiation.
//
// BORDUN (the Orff drone of tonic and fifth). Patterns, as taught in Schulwerk pedagogy:
//   simple (chord)  1+5 struck together
//   broken          1, 5 alternately
//   level           1+5 low, then 1+5 an octave higher, alternately
//   crossover       1, 5, 8, 5 — the lower mallet crosses over to the upper tonic
//   arpeggiated     1, 5, 8 rolling on the eighth grid (three against the duple grid)
//   moving          1+5, then the fifth moves to its upper neighbour and back (5–6–5–6)
// Over bordun, drone and pedal harmony the bordun stays on the tonic; when chords move (shifting,
// modal, functional) it becomes a chord bordun on each chord's root. Cadential bars stop the motion:
// the final bar is a single struck fifth left to ring.

import { chordIntervals, voiceLead } from "../../theory/chords";
import { slotAt, stablePcs } from "../../theory/context";
import { groupStarts } from "../../theory/meter";
import { euclid, rotate } from "../../theory/rhythm";
import { scaleIntervals } from "../../theory/scales";
import type { Beats, Chord, ChordSlot } from "../../theory/types";
import { ensembleInfo } from "../instruments";
import type { BordunType, Draft } from "../types";
import { draft, lowest, mod12, type PartEnv, phraseAt, phraseEnd, place, playable, slotsIn } from "./common";

/** Strike positions inside a bar: every quarter in x/4 meters, every group (2 or 3 eighths) in x/8;
 *  `fine` gives the eighth grid. */
function barPositions(env: PartEnv, fine = false): Beats[] {
  if (fine) {
    const out: Beats[] = [];
    for (let t = 0; t < env.bb - 1e-6; t += 0.5) out.push(t);
    return out;
  }
  const g = groupStarts(env.ctx.timeSig);
  if (env.ctx.timeSig.endsWith("/8")) return g;
  return Array.from({ length: Math.round(env.bb) }, (_, i) => i);
}

const followsChord = (lang: string) => !(lang === "bordun" || lang === "drone" || lang === "pedal");

/** Interval above a root that a bordun pairs with it: the fifth, or the fourth/octave where a scale
 *  or chord has no fifth. */
function bordunInterval(rootPc: number, chord: Chord, scalePcs: number[]): number {
  for (const iv of [7, 5, 8, 6]) if (chord.pcs.includes(mod12(rootPc + iv)) || (iv === 7 && scalePcs.includes(mod12(rootPc + 7)))) return iv;
  return 12;
}

function isFinalBar(env: PartEnv, barStart: Beats): boolean {
  return barStart + env.bb >= env.pieceEnd - 1e-6;
}

function isCadentialBar(env: PartEnv, barStart: Beats): boolean {
  const { phrase } = phraseAt(env.sec, env.bb, barStart);
  const lastBar = barStart + env.bb >= phraseEnd(phrase, env.bb) - 1e-6;
  const sectionEnd = barStart + env.bb >= env.end - 1e-6;
  return lastBar && sectionEnd && phrase.cadence === "full";
}

export function writeBordun(env: PartEnv, type: BordunType): Draft[] {
  const { sec, bb, ctx } = env;
  const out: Draft[] = [];
  const scalePcs = scaleIntervals(sec.scale, ctx.custom).map((i) => mod12(sec.key + i));
  const bars = Math.round((env.end - env.start) / bb);
  let prevRoot: number | undefined = env.memory.lastPitch;
  // cyclic patterns (crossover 1–5–8–5, arpeggiated 1–5–8) run across bar lines
  let cycle = 0;
  for (let b = 0; b < bars; b++) {
    const bar = env.start + b * bb;
    if (!playable(env, bar)) continue;
    const slot = slotAt(ctx, bar);
    const rootPc = followsChord(sec.language) ? slot.chord.rootPc : mod12(sec.key);
    // a pedal point is the tonic alone: when the chord above it lacks the tonic's fifth, the bordun
    // doubles the tonic at the octave instead of sounding a fifth against the chord
    const pedalOnly = sec.language === "pedal" && !slot.chord.pcs.includes(mod12(rootPc + 7));
    const iv = pedalOnly ? 12 : bordunInterval(rootPc, slot.chord, scalePcs);
    let r = lowest(rootPc, env.lo);
    // a chord bordun follows the harmony by the smallest move, staying in the low register
    if (prevRoot !== undefined && followsChord(sec.language)) {
      const alt = r + 12;
      if (alt + iv <= env.hi && Math.abs(alt - prevRoot) < Math.abs(r - prevRoot) - 4) r = alt;
    }
    prevRoot = r;
    const f = r + iv;
    const o = r + 12;
    let t: BordunType = type;
    if (t === "level" && f + 12 > env.hi) t = "broken";
    if (pedalOnly && (t === "moving" || t === "level")) t = "broken";
    if ((t === "crossover" || t === "arpeggiated") && o > env.hi) t = "broken";
    if (isFinalBar(env, bar) || isCadentialBar(env, bar) || sec.fn === "ending" && b === bars - 1) t = "simple";
    const pos = barPositions(env, t === "arpeggiated");
    const strikes: { at: Beats; notes: number[] }[] = [];
    switch (t) {
      case "simple":
        // ambient borduns are struck every second bar and left to ring
        if (env.profile.id === "ambient" && b % 2 === 1 && !isFinalBar(env, bar)) break;
        strikes.push({ at: 0, notes: [r, f] });
        if (bb >= 4 && sec.intensity > 0.55 && !isFinalBar(env, bar)) strikes.push({ at: bb / 2, notes: [r, f] });
        break;
      case "broken":
        pos.forEach((p, i) => strikes.push({ at: p, notes: [i % 2 === 0 ? r : f] }));
        break;
      case "level":
        pos.forEach((p) => strikes.push({ at: p, notes: cycle++ % 2 === 0 ? [r, f] : [r + 12, f + 12] }));
        break;
      case "crossover":
        pos.forEach((p) => strikes.push({ at: p, notes: [[r, f, o, f][cycle++ % 4]] }));
        break;
      case "arpeggiated":
        pos.forEach((p) => strikes.push({ at: p, notes: [[r, f, o][cycle++ % 3]] }));
        break;
      case "moving": {
        const up = scalePcs.map((pc) => place(pc, f + 2, f + 1, f + 4)).filter((m) => m > f && m - f <= 4).sort((a, b2) => a - b2)[0] ?? f;
        pos.forEach((p, i) => strikes.push({ at: p, notes: i === 0 ? [r, f] : [i % 2 === 1 ? up : f] }));
        break;
      }
    }
    // each strike rings until the same voice strikes again (or the bar ends)
    strikes.forEach((s, i) => {
      for (const m of s.notes) {
        let until = bb;
        for (let k = i + 1; k < strikes.length; k++) if (strikes[k].notes.some((x) => mod12(x) === mod12(m) || Math.abs(x - m) <= 4)) { until = strikes[k].at; break; }
        const vel = s.at === 0 ? 0.9 : m === r ? 0.78 : 0.7;
        const final = isFinalBar(env, bar);
        const ringBars = env.profile.id === "ambient" && t === "simple" ? 2 : 1;
        out.push(draft(bar + s.at, final ? Math.max(bb, 2) : Math.min(until - s.at + (ringBars - 1) * bb, env.end - bar - s.at), m, vel, final ? "final" : `bordun-${t}`));
      }
    });
  }
  env.memory.lastPitch = prevRoot;
  return out;
}

// ------------------------------------------------------------------ bass foundation

export function writeBass(env: PartEnv): Draft[] {
  const { sec, bb, ctx } = env;
  const out: Draft[] = [];
  const bordunActive = Object.entries(sec.parts).some(([id, p]) => p.technique === "bordun" && id !== env.track.id);
  const short = ensembleInfo(env.track.instrumentId).sustain === "short";
  const lowTop = Math.min(env.hi, env.lo + 16);
  let prev = env.memory.lastPitch ?? lowest(sec.key, env.lo);
  const pieces = slotsIn(ctx, env.start, env.end);
  pieces.forEach((pc, idx) => {
    const { slot } = pc;
    const nextSlot = pieces[idx + 1]?.slot;
    for (let bar = Math.floor((pc.from - env.start) / bb + 1e-9) * bb + env.start; bar < pc.to - 1e-6; bar += bb) {
      const from = Math.max(bar, pc.from);
      const to = Math.min(bar + bb, pc.to);
      if (!playable(env, from)) continue;
      const rootPc = slot.bassPc;
      const root = place(rootPc, prev, env.lo, lowTop);
      const fifthPc = slot.chord.pcs.includes(mod12(rootPc + 7)) ? mod12(rootPc + 7) : stablePcs(slot).find((x) => x !== rootPc) ?? rootPc;
      const fifth = place(fifthPc, root + 7, root, Math.min(env.hi, root + 12));
      const first = from === pc.from || from === bar;
      const len = to - from;
      const finalBar = from + bb >= env.pieceEnd - 1e-6;
      if (finalBar) {
        out.push(draft(from, Math.max(len, 2), root, 0.95, "final"));
        prev = root;
        continue;
      }
      // sparse foundation under a bordun, or at low intensity: the root, restruck per bar on wood
      if (bordunActive || sec.intensity < 0.45 || env.profile.id === "ambient") {
        if (first && (short || from === pc.from || (from - pc.from) % (2 * bb) < 1e-6)) out.push(draft(from, short ? Math.min(len, bb) : pc.to - from, root, 0.9, "bass-root"));
        prev = root;
        continue;
      }
      const mid = groupStarts(ctx.timeSig).find((g) => g >= len / 2 - 1e-6 && g > 0) ?? len / 2;
      out.push(draft(from, Math.min(mid, len), root, 0.92, "bass-root"));
      if (mid < len - 1e-6) {
        const lastBeforeChange = nextSlot && bar + bb >= pc.to - 1e-6;
        if (sec.intensity > 0.7 && lastBeforeChange && nextSlot) {
          // approach the next root by step (or by its fifth) on the last group of the bar
          const target = place(nextSlot.bassPc, root, env.lo, lowTop);
          // approach the next root by a whole step from the scale (a semitone below would rub against
          // whatever still sounds the current chord), else by its fifth
          const steps = ctx.pcs.map((pc) => place(pc, target + (target > root ? -2 : 2), target - 3, target + 3)).filter((m) => Math.abs(m - target) === 2);
          const approach = steps[0] ?? place(mod12(nextSlot.bassPc + 7), target - 5, env.lo, lowTop);
          const at = from + (groupStarts(ctx.timeSig).slice(-1)[0] ?? mid);
          out.push(draft(from + mid, at - (from + mid) > 0.25 ? at - (from + mid) : len - mid, fifth, 0.72, "bass-fifth"));
          if (at > from + mid + 0.25 && at < to - 0.25) out.push(draft(at, to - at, approach, 0.7, "bass-approach"));
        } else out.push(draft(from + mid, len - mid, sec.intensity > 0.6 && from > pc.from ? root + 12 <= env.hi && env.r.chance(0.3) ? root + 12 : fifth : fifth, 0.74, "bass-fifth"));
      }
      prev = root;
    }
  });
  env.memory.lastPitch = prev;
  return out;
}

// ------------------------------------------------------------------ harmony

/** The tones a two- or three-mallet harmony part plays: third and seventh (or fifth), the root only
 *  when no bass covers it. */
export function guideTones(chord: Chord, count: number, withRoot: boolean): Chord {
  const ivs = chordIntervals(chord).map((x) => x % 12);
  const pick: number[] = [];
  const third = ivs.find((x) => x === 3 || x === 4) ?? ivs.find((x) => x === 2 || x === 5);
  const seventh = ivs.find((x) => x === 10 || x === 11 || x === 9);
  const fifth = ivs.find((x) => x === 7 || x === 6 || x === 8);
  if (withRoot) pick.push(0);
  if (third !== undefined) pick.push(third);
  if (seventh !== undefined) pick.push(seventh);
  if (fifth !== undefined) pick.push(fifth);
  for (const x of ivs) if (!pick.includes(x)) pick.push(x);
  const chosen = [...new Set(pick)].slice(0, Math.max(1, count)).sort((a, b) => a - b);
  return { ...chord, ivs: chosen, pcs: chosen.map((x) => mod12(chord.rootPc + x)) };
}

export function writeHarmony(env: PartEnv): Draft[] {
  const { sec, bb, ctx } = env;
  const info = ensembleInfo(env.track.instrumentId);
  const mallets = env.realism === "orff" ? info.mallets : 4;
  const count = Math.max(2, Math.min(mallets, sec.intensity > 0.7 ? 3 : 2));
  const bassPresent = Object.entries(sec.parts).some(([id, p]) => id !== env.track.id && (p.technique === "bass" || p.technique === "bordun"));
  const out: Draft[] = [];
  let prev = env.memory.voicing ?? null;
  const rhythmic = env.profile.id !== "ambient" && (info.sustain === "short" || sec.intensity > 0.75);
  for (const pc of slotsIn(ctx, env.start, env.end)) {
    const chord = guideTones(pc.slot.chord, count, !bassPresent);
    const v = voiceLead(prev, chord, env.lo, env.hi, count).filter((m) => m >= env.lo && m <= env.hi);
    if (!v.length) continue;
    prev = v;
    for (let bar = pc.from; bar < pc.to - 1e-6; bar += bb) {
      const len = Math.min(bb, pc.to - bar);
      if (!playable(env, bar)) continue;
      if (!rhythmic) {
        // sustained: one strike per chord (restruck every second bar of a long chord, softly)
        const fromChord = bar - pc.from;
        if (fromChord > 1e-6 && Math.round(fromChord / bb) % 2 === 1) continue;
        const dur = Math.min(pc.to - bar, 2 * bb);
        for (const m of v) out.push(draft(bar, dur, m, fromChord > 1e-6 ? 0.55 : 0.72, "harmony"));
        continue;
      }
      const steps = Math.max(2, Math.round(len / 0.5));
      const k = Math.max(1, Math.min(steps, Math.round(steps * (0.25 + 0.35 * sec.intensity))));
      const pat = rotate(euclid(k, steps), 0);
      pat.forEach((on, i) => {
        if (!on) return;
        const at = bar + i * 0.5;
        if (at >= pc.to - 1e-6) return;
        let next = i + 1;
        while (next < steps && !pat[next]) next++;
        for (const m of v) out.push(draft(at, Math.min(next * 0.5 + bar, pc.to) - at, m, i === 0 ? 0.75 : 0.62, "harmony"));
      });
    }
  }
  env.memory.voicing = prev ?? undefined;
  return out;
}

// ------------------------------------------------------------------ arpeggio

type ArpShape = "up" | "updown" | "broken" | "rolling";

export function writeArpeggio(env: PartEnv): Draft[] {
  const { sec, bb, ctx, controls } = env;
  const compound = ctx.timeSig.endsWith("/8");
  const fast = !compound && controls.rhythmicComplexity > 0.6 && env.bpm <= 112;
  const g = fast ? 0.25 : 0.5;
  const letter = sec.theme ?? "intro";
  const shape: ArpShape = (env.memory.borduns[`arp:${letter}`] as ArpShape) ?? env.r.pick(["up", "updown", "broken", "rolling"] as const);
  env.memory.borduns[`arp:${letter}`] = shape;
  const out: Draft[] = [];
  let last = env.memory.lastPitch ?? Math.round((env.lo + env.hi) / 2);
  for (const pc of slotsIn(ctx, env.start, env.end)) {
    const tones = arpTones(pc.slot, ctx.behavior === "strict" ? ctx.pcs : null, last, env.lo, env.hi);
    if (tones.length < 2) continue;
    const seq = shape === "up" ? tones : shape === "updown" ? [...tones, ...tones.slice(1, -1).reverse()] : shape === "broken" ? brokenOrder(tones) : [...tones, ...tones.slice(0, -1).reverse()].filter((_, i) => i % 2 === 0 || tones.length < 4);
    let i = 0;
    for (let t = pc.from; t < pc.to - 1e-6; t += g) {
      if (!playable(env, t)) continue;
      const { phrase } = phraseAt(sec, bb, t);
      const pe = phraseEnd(phrase, bb);
      // into a full cadence the figure slows and settles on a chord tone that rings
      if (phrase.cadence === "full" && t >= pe - bb + 1e-6) {
        if (Math.abs(t - (pe - bb)) < g / 2) out.push(draft(t, bb, seq[0], 0.7, "arpeggio-cadence"));
        continue;
      }
      const m = seq[i % seq.length];
      out.push(draft(t, g * (ensembleInfo(env.track.instrumentId).sustain === "long" ? 2 : 1), m, i % (compound ? 3 : 4) === 0 ? 0.78 : 0.6, `arpeggio-${shape}`));
      last = m;
      i++;
    }
  }
  env.memory.lastPitch = last;
  return out;
}

function arpTones(slot: ChordSlot, scalePcs: number[] | null, near: number, lo: number, hi: number): number[] {
  const pcs = scalePcs ? slot.chord.pcs.filter((pc) => scalePcs.includes(pc)) : slot.chord.pcs;
  const startPc = slot.chord.rootPc;
  const root = place(startPc, near - 5, lo, hi - 7);
  const out: number[] = [];
  for (let m = root; m <= Math.min(hi, root + 19); m++) if (pcs.includes(mod12(m))) out.push(m);
  return out.slice(0, 6);
}

function brokenOrder(t: number[]): number[] {
  // Alberti-like: low, high, middle, high
  if (t.length < 3) return t;
  return [t[0], t[2], t[1], t[2]];
}
