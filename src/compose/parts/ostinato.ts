// OSTINATO. A short cell repeated literally, so the ear can lean on it.
//
// The cell's rhythm is written against the theme: positions where the theme strikes are avoided
// and the gaps filled (interlocking parts), and a second ostinato in the same section fills the
// first one's gaps. Its pitches are a narrow figure (do–re–mi–re, do–sol–la–sol) hung from a chord
// tone. Over a bordun or pedal the cell stays put; when chords move it is moved by scale steps to
// each chord (a "moving ostinato") and exposed notes are nudged onto chord tones.
//
// Processes (profile.process):
//   minimal — additive build-up (notes revealed one repetition at a time), subtractive reduction,
//             discrete phase shifting (one part's cell displaced one grid step every few bars), and
//             mutation (one note substituted each new section);
//   poly    — the cell is a Euclidean timeline on a cycle that is not the bar (tresillo E(3,8), the
//             12/8 bell E(7,12), cycles of 5, 6, 12 …), chosen so it realigns with the bar at the
//             section's end, and its pitch sequence (colour) has a different length from its onset
//             count (talea): an isorhythm whose melody keeps turning over.

import { adaptNotes, isChordTone, slotAt } from "../../theory/context";
import { METERS, metricWeight } from "../../theory/meter";
import { euclid, lcm, rotate } from "../../theory/rhythm";
import type { Beats } from "../../theory/types";
import type { Draft } from "../types";
import { degreeFrame, draft, mod12, type OstinatoCell, type PartEnv, playable, strength } from "./common";

function grid(env: PartEnv): Beats {
  const { profile, controls, bpm, ctx } = env;
  if (ctx.timeSig.endsWith("/8")) return 0.5;
  if (profile.process === "minimal") return bpm <= 134 ? 0.25 : 0.5;
  return controls.rhythmicComplexity > 0.62 && bpm <= 120 ? 0.25 : 0.5;
}

/** Positions (in grid steps, modulo the cell) where the section's theme strikes. */
function themeSteps(env: PartEnv, g: Beats, length: number): Set<number> {
  const t = env.themes[env.sec.theme ?? ""];
  const out = new Set<number>();
  if (!t) return out;
  for (const n of t.motif.notes) out.add(Math.round(n.at / g) % length);
  return out;
}

function makeCell(env: PartEnv, g: Beats, length: number, interlockWith: Set<number> | null): OstinatoCell {
  const { r, controls, profile } = env;
  const f = degreeFrame(env);
  const theme = themeSteps(env, g, length);
  const fill = 0.28 + 0.3 * controls.density + 0.14 * controls.rhythmicComplexity + (profile.process === "minimal" ? 0.12 : 0);
  const k = Math.max(2, Math.min(length - 1, Math.round(length * fill)));
  const weights = Array.from({ length }, (_, i) => {
    const pos = (i * g) % env.bb;
    let w = 0.35 + metricWeight(env.ctx.timeSig, pos);
    if (theme.has(i)) w *= 0.45;
    if (interlockWith?.has(i)) w *= 0.12;
    return w;
  });
  const chosen = new Set<number>();
  if (!interlockWith || r.chance(0.35)) chosen.add(0);
  else {
    const off = [...Array(length).keys()].find((i) => !interlockWith.has(i));
    if (off !== undefined) chosen.add(off);
  }
  const pool = [...Array(length).keys()];
  while (chosen.size < k) {
    const cand = pool.filter((i) => !chosen.has(i));
    if (!cand.length) break;
    chosen.add(r.weighted(cand, cand.map((i) => weights[i] + (chosen.has(i - 1) ? -0.1 : 0.05))));
  }
  const at = [...chosen].sort((a, b) => a - b);
  // a narrow figure around a chord tone in the middle of the part's range
  const anchor = f.toDeg(Math.round(env.lo + (env.hi - env.lo) * 0.4));
  const degs: number[] = [0];
  for (let i = 1; i < at.length; i++) {
    const prev = degs[i - 1];
    const opts = [-2, -1, 1, 2, 0, 3].filter((d) => prev + d >= -2 && prev + d <= 4);
    degs.push(prev + r.weighted(opts, opts.map((d) => (Math.abs(d) === 1 ? 3 : d === 0 ? 0.8 : 1.4))));
  }
  return {
    steps: at.map((s, i) => ({ at: s, len: Math.min(4, (at[i + 1] ?? length + at[0]) - s), deg: degs[i] })),
    length,
    grid: g,
    anchor,
  };
}

/** One section of mutation: a single note of the cell moves by a scale step (minimalism). */
function mutate(cell: OstinatoCell, env: PartEnv): OstinatoCell {
  if (cell.steps.length < 2) return cell;
  const k = env.r.int(1, cell.steps.length - 1);
  return { ...cell, steps: cell.steps.map((s, i) => (i === k ? { ...s, deg: Math.max(-2, Math.min(4, s.deg + env.r.pick([-1, 1]))) } : s)) };
}

/** A cycle length (in steps) for a polyrhythmic part that differs from the bar but realigns with it
 *  at the end of the section, plus a Euclidean density for it. */
function polyCycle(env: PartEnv, g: Beats, barSteps: number, sectionSteps: number, taken: number[]): { length: number; pulses: number } {
  const meter = env.ctx.timeSig;
  const options = meter === "12/8" ? [12, 8, 9, 6, 4] : meter === "6/8" ? [4, 6, 9, 8] : meter === "4/4" ? (g === 0.25 ? [8, 12, 6, 10, 5, 16] : [6, 3, 5, 8, 10]) : [barSteps - 1, barSteps + 1, 3, 5, barSteps];
  const scored = options
    .filter((L) => L >= 3)
    .map((L) => ({ L, s: (sectionSteps % lcm(L, barSteps) === 0 ? 2 : 0) + (taken.includes(L) ? -3 : 0) + (L === barSteps ? -1 : 0) + env.r() }))
    .sort((a, b) => b.s - a.s);
  const L = scored[0]?.L ?? barSteps;
  const pulses = L === 12 ? env.r.pick([7, 5]) : L === 8 ? env.r.pick([3, 5]) : L === 16 ? env.r.pick([5, 7, 9]) : Math.max(2, Math.round(L * (0.4 + 0.2 * env.controls.density)));
  return { length: L, pulses };
}

export function writeOstinato(env: PartEnv): Draft[] {
  const { sec, bb, ctx, profile, controls } = env;
  const g = grid(env);
  const barSteps = Math.round(bb / g);
  const sectionSteps = Math.round((env.end - env.start) / g);
  const letter = sec.theme ?? sec.fn;
  const othersRhythm = env.shared.ostinatoRhythms.length ? env.shared.ostinatoRhythms[0] : null;
  const f = degreeFrame(env);
  const out: Draft[] = [];

  // ---- polyrhythmic: Euclidean timeline on its own cycle, isorhythmic colour
  if (profile.process === "poly") {
    const { length, pulses } = polyCycle(env, g, barSteps, sectionSteps, env.shared.cycles);
    const pat = rotate(euclid(pulses, length), env.r.int(0, length - 1));
    const colourLen = Math.max(2, pulses + (env.r.chance(0.5) ? 1 : -1));
    const cell = env.memory.cells[letter] ?? makeCell(env, g, colourLen * 2, null);
    env.memory.cells[letter] = cell;
    const colour = cell.steps.map((s) => s.deg).slice(0, colourLen);
    while (colour.length < colourLen) colour.push(colour[colour.length - 1] ?? 0);
    env.shared.cycles.push(length);
    env.shared.ostinatoRhythms.push(new Set([...Array(length).keys()].filter((i) => pat[i])));
    env.memory.cycle = length;
    let ci = 0;
    for (let s = 0; s < sectionSteps; s++) {
      if (!pat[s % length]) continue;
      const beat = env.start + s * g;
      if (!playable(env, beat)) {
        ci++;
        continue;
      }
      let next = s + 1;
      while (next < s + length && !pat[next % length]) next++;
      const deg = cell.anchor + colour[ci % colourLen];
      ci++;
      out.push(draft(beat, Math.min(4, next - s) * g, f.toMidi(deg), s % barSteps === 0 ? 0.85 : 0.68, `ostinato-cycle${length}`, `${letter}:ostinato`));
    }
    return fitChords(env, out);
  }

  // ---- metric ostinato
  const cellBars = bb <= 2.5 ? 2 : 1;
  const length = barSteps * cellBars;
  let cell = env.memory.cells[letter];
  if (!cell || cell.length !== length || cell.grid !== g) cell = makeCell(env, g, length, othersRhythm);
  else if (profile.process === "minimal" && !env.hold && env.r.chance(0.35 + controls.evolution * 0.5)) cell = mutate(cell, env);
  env.memory.cells[letter] = cell;
  env.shared.ostinatoRhythms.push(new Set(cell.steps.map((s) => s.at)));

  const reps = Math.ceil(sectionSteps / length);
  const minimal = profile.process === "minimal";
  const second = env.shared.ostinatoRhythms.length > 1;
  const additive = minimal && (sec.fn === "intro" || (sec.fn === "development" && sec.variant === 1 && !second));
  const subtractive = minimal && sec.fn === "ending";
  const phasing = minimal && second && sec.fn !== "intro" && sec.fn !== "ending";
  const phaseEvery = Math.max(1, Math.round(4 - controls.evolution * 2));
  const followChords = !(sec.language === "bordun" || sec.language === "drone" || sec.language === "pedal");
  const tonicDeg = 0;
  // processes count repetitions from the part's own entrance
  const firstRep = Math.floor((env.part.enterBar * bb) / (length * g) + 1e-9);
  for (let rep = 0; rep < reps; rep++) {
    const cellStart = env.start + rep * length * g;
    const own = Math.max(0, rep - firstRep);
    const left = Math.max(1, reps - firstRep);
    const visible = additive ? Math.min(cell.steps.length, 1 + own) : subtractive ? Math.max(1, cell.steps.length - Math.floor((own * cell.steps.length) / left)) : cell.steps.length;
    const displacement = phasing ? Math.floor(own / phaseEvery) % length : 0;
    // a moving ostinato follows each chord by the root's scale-step distance from the tonic
    const slot = slotAt(ctx, cellStart);
    let move = 0;
    if (followChords && slot.chord.degree >= 0) {
      const n = ctx.pcs.length;
      move = ((slot.chord.degree - tonicDeg) % n + n) % n;
      if (move > n / 2) move -= n;
    }
    cell.steps.slice(0, visible).forEach((st) => {
      const at = (st.at + displacement) % length;
      const beat = cellStart + at * g;
      if (beat >= env.end - 1e-6 || !playable(env, beat)) return;
      const deg = cell.anchor + st.deg + move;
      let midi = f.toMidi(deg);
      while (midi > env.hi) midi -= 12;
      while (midi < env.lo) midi += 12;
      out.push(draft(beat, Math.min(st.len * g, env.end - beat), midi, at === 0 ? 0.82 : strength(env, beat) >= 0.75 ? 0.74 : 0.64, phasing && displacement ? `ostinato-phase${displacement}` : additive ? "ostinato-additive" : subtractive ? "ostinato-subtractive" : "ostinato", `${letter}:ostinato`));
    });
  }
  out.sort((a, b) => a.start - b.start);
  return fitChords(env, out);
}

/** Exposed ostinato notes that miss the chord move to the nearest chord tone (guided adaptation). */
function fitChords(env: PartEnv, notes: Draft[]): Draft[] {
  if (env.sec.language === "bordun" || env.sec.language === "drone") return notes;
  const adapted = adaptNotes(env.ctx, notes, "guided", 0.5);
  return adapted.map((n) => (n.midi < env.lo || n.midi > env.hi ? { ...n, midi: n.midi + (n.midi < env.lo ? 12 : -12) } : n));
}

export const ostinatoIsChordTone = (env: PartEnv, n: Draft) => isChordTone(env.ctx, n.midi, n.start) || mod12(n.midi) === mod12(env.sec.key);

export const meterSteps = (meter: keyof typeof METERS, g: Beats) => Math.round(METERS[meter].barBeats / g);
