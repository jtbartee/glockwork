// IMITATION. Elemental ensembles make one melody into several parts. Every device here is a
// transformation of the carrier's actual line, so the follower's material is motivically the same:
//
//   echo       — the follower repeats the carrier's last statement in the silence it left at the
//                end of each phrase, and makes the cadence (the "glockenspiel answering")
//   call       — call and response: questions on the carrier, answers on the follower
//   canon      — the line delayed and transposed by octaves; the delay is chosen by measuring the
//                clashes each candidate delay produces against the carrier (a round has several
//                followers entering one after another)
//   hocket     — the line split note by note between instruments (round-robin across several for
//                a pointillist hocket); long and cadence notes stay with the carrier
//   imitation  — each phrase's head answered a statement later at the fourth or fifth
//   parallel   — the line doubled a third (or, in pentatonic, a scale step pair) away
//   heterophony— a simplified line: the strong-beat skeleton of the melody, held

import { adaptNotes, isChordTone, nearestChordTone } from "../../theory/context";
import { scaleIntervals } from "../../theory/scales";
import type { Beats } from "../../theory/types";
import type { Draft, ImitationKind } from "../types";
import { landCadence } from "./melody";
import { degreeFrame, draft, mod12, type PartEnv, phraseAt, phraseEnd, soundingAt, strength } from "./common";

/** Shift a whole run of notes by octaves so it sits in [lo, hi] (contour intact), folding only
 *  what still sticks out. */
export function fitRegister(notes: Draft[], lo: number, hi: number, interval: number): Draft[] {
  if (!notes.length) return [];
  const moved = notes.map((n) => ({ ...n, midi: n.midi + interval }));
  const mn = Math.min(...moved.map((n) => n.midi));
  const mx = Math.max(...moved.map((n) => n.midi));
  let shift = 0;
  let best = Infinity;
  for (let k = -4; k <= 4; k++) {
    const out = Math.max(0, lo - (mn + 12 * k)) + Math.max(0, mx + 12 * k - hi);
    const cost = out * 10 + Math.abs(k);
    if (cost < best) {
      best = cost;
      shift = 12 * k;
    }
  }
  return moved.map((n) => {
    let m = n.midi + shift;
    while (m > hi) m -= 12;
    while (m < lo) m += 12;
    return { ...n, midi: m };
  });
}

/** Clash severity of two simultaneous pitches (0 = consonant, 1 = semitone rub). */
export function clash(a: number, b: number): number {
  const ic = mod12(a - b);
  const wide = Math.abs(a - b) > 12;
  if (ic === 1 || ic === 11) return wide ? 0.55 : 1;
  if (ic === 6) return 0.45;
  if (ic === 2 || ic === 10) return wide ? 0.08 : 0.2;
  return 0;
}

function canonScore(env: PartEnv, line: Draft[], follower: Draft[]): number {
  let s = 0;
  let n = 0;
  for (const f of follower) {
    const c = soundingAt(line, f.start);
    if (!c) continue;
    const w = strength(env, f.start);
    s += clash(f.midi, c.midi) * (0.4 + w);
    n++;
  }
  return n ? s / n : 0;
}

/** Diatonic transposition by scale steps (keeps notes in the scale). */
function stepTranspose(env: PartEnv, notes: Draft[], steps: number): Draft[] {
  const f = degreeFrame({ ctx: env.ctx, lo: env.lo - 24, hi: env.hi + 24 });
  return notes.map((n) => ({ ...n, midi: f.toMidi(f.toDeg(n.midi) + steps) }));
}

/** Follower notes that rub against the carrier on strong beats move to the nearest chord tone. */
function soften(env: PartEnv, notes: Draft[], line: Draft[]): Draft[] {
  const limit = env.ctx.behavior === "experimental" ? 0.9 : env.ctx.behavior === "expressive" ? 0.6 : 0.4;
  return notes.map((n) => {
    const c = soundingAt(line, n.start);
    if (!c || clash(n.midi, c.midi) < limit || strength(env, n.start) < 0.5) return n;
    const m = nearestChordTone(env.ctx, n.midi, n.start, 0, "melody");
    return clash(m, c.midi) < clash(n.midi, c.midi) && m >= env.lo && m <= env.hi ? { ...n, midi: m } : n;
  });
}

/** Which share of the carrier's full line the carrier itself keeps under each device. */
export function carrierShare(kind: ImitationKind, line: Draft[], env: Pick<PartEnv, "sec" | "bb">, voices: number): Draft[] {
  if (kind === "call") return line.filter((n) => phraseAt(env.sec, env.bb, n.start).index % 2 === 0);
  if (kind === "hocket") return line.filter((n, i) => hocketOwner(line, i, voices) === 0);
  return line;
}

function hocketOwner(line: Draft[], i: number, voices: number): number {
  const n = line[i];
  if (n.tag === "cadence" || n.dur >= 1.5) return 0;
  return i % (voices + 1);
}

/** Write a follower's part for the section's imitation device. `which` is the follower's index
 *  among several (rounds, pointillist hocket). */
export function writeImitation(env: PartEnv, kind: ImitationKind, which: number, voices: number): Draft[] {
  const line = env.shared.carrierFull;
  if (!line.length) return [];
  const { sec, bb } = env;
  const interval = sec.imitation.interval;
  const secEnd = env.end;
  switch (kind) {
    case "echo": {
      const out: Draft[] = [];
      for (const u of env.shared.echoUnits) {
        const src = line.filter((n) => n.start >= u.from - 1e-6 && n.start < u.to - 1e-6);
        const shiftBy = u.to - u.from;
        let copy = fitRegister(src.map((n) => ({ ...n, start: n.start + shiftBy, tag: "echo" })), env.lo, env.hi, interval);
        copy = adaptNotes(env.ctx, copy.map((n) => ({ ...n, dur: Math.min(n.dur, u.phraseEnd - n.start) })), "guided", 0.6);
        if (copy.length) {
          const last = copy[copy.length - 1];
          last.midi = landCadence(env, last.midi, copy[copy.length - 2]?.midi, last.start, u.cadence);
          last.dur = Math.max(last.dur, u.phraseEnd - last.start - Math.min(1, bb / 4));
          last.tag = "cadence";
        }
        out.push(...copy.map((n) => ({ ...n, vel: n.vel * 0.85 })));
      }
      return out;
    }
    case "call": {
      // the partner answers in the carrier's own register where its range allows
      const answers = line.filter((n) => phraseAt(sec, bb, n.start).index % 2 === 1).map((n) => ({ ...n, tag: n.tag === "cadence" ? "cadence" : "response" }));
      return fitPhrases(env, answers, 0);
    }
    case "hocket": {
      const mine = line.filter((_, i) => hocketOwner(line, i, voices) === which + 1).map((n) => ({ ...n, tag: "hocket" }));
      return fitPhrases(env, mine, 0);
    }
    case "canon": {
      const base = Math.max(1, sec.imitation.offsetBars);
      const options = [...new Set([base, base * 2, Math.max(1, Math.round(env.plan.phraseBars / 2)), env.plan.phraseBars])].filter((o) => o * bb < env.end - env.start);
      let best: Draft[] = [];
      let bestScore = Infinity;
      for (const o of options) {
        const delay = o * bb * (which + 1);
        const shifted = line.filter((n) => n.start + delay < secEnd - 1e-6).map((n) => ({ ...n, start: n.start + delay, dur: Math.min(n.dur, secEnd - (n.start + delay)), tag: "canon" }));
        const fitted = fitRegister(shifted, env.lo, env.hi, interval);
        const sc = canonScore(env, line, fitted) + o * 0.002;
        if (sc < bestScore) {
          bestScore = sc;
          best = fitted;
        }
      }
      return soften(env, best, line);
    }
    case "imitation": {
      const out: Draft[] = [];
      const steps = scaleIntervals(env.ctx.scale, env.ctx.custom).length >= 7 ? -3 : -2;
      const unit = Math.max(bb, (env.themes[sec.theme ?? "A"]?.bars ?? 1) * bb);
      for (const ph of sec.phrases) {
        const ps = ph.startBar * bb;
        const head = line.filter((n) => n.start >= ps - 1e-6 && n.start < ps + unit - 1e-6);
        const moved = head.map((n) => ({ ...n, start: n.start + unit, tag: "imitation" })).filter((n) => n.start < phraseEnd(ph, bb) - 1e-6);
        out.push(...fitRegister(stepTranspose(env, moved, steps), env.lo, env.hi, interval));
      }
      return soften(env, out, line);
    }
    case "parallel": {
      // two scale steps: a third in a seven-note scale; a third or fourth in a pentatonic one
      const above = env.lo + env.hi > 2 * avg(line.map((n) => n.midi)) + 12;
      const moved = stepTranspose(env, line, above ? 2 : -2);
      const fitted = fitRegister(moved.map((n) => ({ ...n, tag: "parallel" })), env.lo, env.hi, above ? interval : Math.min(0, interval));
      // a parallel line keeps chord tones where the melody does
      return fitted.map((n, i) => {
        const src = line[i];
        if (!src || strength(env, n.start) < 0.75 || isChordTone(env.ctx, n.midi, n.start) || !isChordTone(env.ctx, src.midi, src.start)) return n;
        return { ...n, midi: nearestChordTone(env.ctx, n.midi, n.start, above ? 1 : -1, "melody") };
      });
    }
    case "heterophony": {
      const kept = line.filter((n) => strength(env, n.start) >= 0.75 || n.dur >= 1 || n.tag === "cadence");
      const held = kept.map((n, i) => ({ ...n, dur: Math.max(n.dur, ((kept[i + 1]?.start ?? secEnd) - n.start) * 0.95), tag: "heterophony" }));
      return fitRegister(held, env.lo, env.hi, interval || (env.lo > avg(line.map((x) => x.midi)) ? 12 : -12));
    }
    default:
      return [];
  }
}

/** Fit each phrase's notes into the follower's register separately (keeps each phrase's contour). */
function fitPhrases(env: PartEnv, notes: Draft[], interval: number): Draft[] {
  const byPhrase = new Map<number, Draft[]>();
  for (const n of notes) {
    const k = phraseAt(env.sec, env.bb, n.start).index;
    const list = byPhrase.get(k) ?? [];
    list.push(n);
    byPhrase.set(k, list);
  }
  return [...byPhrase.values()].flatMap((ns) => fitRegister(ns, env.lo, env.hi, interval));
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** A derived line for a secondary part that is not a formal follower (parallel / heterophony). */
export function writeDerived(env: PartEnv, kind: "parallel" | "heterophony"): Draft[] {
  const n = writeImitation(env, kind, 0, 1);
  return n.filter((x) => x.start < env.end - 1e-6).map((x) => draft(x.start, x.dur, x.midi, x.vel * 0.85, x.tag ?? kind, x.motif));
}

export const echoDelay = (u: { from: Beats; to: Beats }) => u.to - u.from;
