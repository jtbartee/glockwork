// HARMONY PLANNER. Writes the one chord timeline of a section, phrase by phrase, so cadences fall
// where the form put them: a question phrase arrives on an open chord (or, over a bordun, stays on
// the tonic and lets the melody end open), an answer closes on the tonic.
//
// A scale is a vocabulary, not a progression. The languages:
//   bordun     — the tonic and its fifth, held throughout: the melody alone creates motion (Orff)
//   shifting   — Orff "shifting chords": the tonic chord rocking with the chord a step away
//                (I–ii in major pentatonic, i–♭VII in minor/Dorian)
//   drone      — one centre whose colour changes (sus2, add9, sus4), for ambient music
//   modal      — the mode's own colour chords around its tonic, cadencing without a leading tone
//   functional — a Markov walk toward the scale's cadence (APERTURE), with borrowed chords when
//                the behaviour is Expressive
//   pedal      — functional/modal chords over a held tonic bass
//   sparse     — slow common-tone motion (APERTURE)
//   planing    — nonfunctional parallel motion of one chord shape along the scale
//   chromatic  — chromatic mediants around the tonic (Experimental only)
// Chord shapes always come from APERTURE's honest-chord vocabulary (theory/chords.ts), so in a
// pentatonic scale every chord tone is a scale tone.

import { CHORD_FORMULAS, chordFromQuality, colourChord, diatonicChord, stableDegree, type Colour, type ScaleRef } from "../theory/chords";
import { barBeats } from "../theory/meter";
import { cadenceDegree, colourDegrees, MARKOV } from "../theory/progression";
import type { Rng } from "../theory/rng";
import { scaleFamily, scaleIntervals } from "../theory/scales";
import type { Beats, Chord, ChordSlot, HarmonicFunction, HarmonyBehavior, MeterId, ScaleId } from "../theory/types";
import type { Profile } from "./profiles";
import type { ComposeControls, HarmonyLanguage, Phrase, Section } from "./types";

const mod12 = (x: number) => ((x % 12) + 12) % 12;

export interface HarmonyEnv {
  meter: MeterId;
  behavior: HarmonyBehavior;
  profile: Profile;
  controls: ComposeControls;
  custom?: number[];
  /** pitch classes of a locked melody weighted by metric strength, per beat window */
  melodyWeight?: (from: Beats, to: Beats) => Map<number, number>;
}

interface Step {
  deg: number;
  func: HarmonicFunction;
  tension: number;
  chord?: Chord;
  colour?: Colour;
}

/** The degree a whole step away that Orff shifting chords rock to. */
export function shiftDegree(key: number, scale: ScaleId, custom?: number[]): number {
  const iv = scaleIntervals(scale, custom);
  const minor = iv.includes(3) && !iv.includes(4);
  const order = minor ? [10, 2, 5] : [2, 10, 9];
  for (const want of order) {
    const d = iv.indexOf(want);
    if (d > 0 && stableDegree(d, key, scale, custom)) return d;
  }
  return Math.min(1, iv.length - 1);
}

/** Degree of the subdominant (plagal) chord, or the cadence degree when the scale has none. */
function plagalDegree(key: number, scale: ScaleId, custom?: number[]): number {
  const iv = scaleIntervals(scale, custom);
  const d = iv.indexOf(5);
  return d > 0 && stableDegree(d, key, scale, custom) ? d : cadenceDegree(key, scale, custom);
}

/** Degree of the deceptive-cadence chord (vi, else ♭VI, else the colour chord). */
function deceptiveDegree(key: number, scale: ScaleId, custom?: number[]): number {
  const iv = scaleIntervals(scale, custom);
  for (const want of [9, 8, 3, 4]) {
    const d = iv.indexOf(want);
    if (d > 0 && stableDegree(d, key, scale, custom)) return d;
  }
  return colourDegrees(key, scale, custom)[0] ?? 0;
}

/** Bars per chord: the profile's harmonic rhythm, faster with harmonic complexity. */
export function harmonicRhythm(profile: Profile, controls: ComposeControls, language: HarmonyLanguage): number {
  if (language === "bordun") return Infinity;
  const c = controls.harmonicComplexity;
  const base = profile.harmonicRhythm * (c < 0.3 ? 2 : c > 0.78 ? 0.5 : 1);
  return Math.max(0.5, Math.min(8, base));
}

/** Stacked chord size: elemental music stays in triads/dyads; complexity adds sevenths and ninths. */
function chordSize(profile: Profile, controls: ComposeControls, scale: ScaleId, custom?: number[]): number {
  const c = controls.harmonicComplexity;
  if (scaleFamily(scale, custom) !== "heptatonic") return c > 0.6 ? 4 : 3;
  if (profile.id === "traditional") return c > 0.85 ? 4 : 3;
  return c < 0.35 ? 3 : c < 0.8 ? 4 : 5;
}

/** Write the chord timeline for one section. */
export function sectionHarmony(sec: Section, env: HarmonyEnv, prevSlot: ChordSlot | null, r: Rng): ChordSlot[] {
  const bb = barBeats(env.meter);
  const key = sec.key;
  const scale = sec.scale;
  const custom = env.custom;
  const sc: ScaleRef = { root: key, scale, custom };
  const iv = scaleIntervals(scale, custom);
  const n = iv.length;
  const fam = scaleFamily(scale, custom);
  const size = chordSize(env.profile, env.controls, scale, custom);
  const usable = Array.from({ length: n }, (_, d) => d).filter((d) => d === 0 || stableDegree(d, key, scale, custom));
  const cad = cadenceDegree(key, scale, custom);
  const colours = colourDegrees(key, scale, custom);
  const shift = shiftDegree(key, scale, custom);
  let language: HarmonyLanguage = sec.language;
  if (language === "chromatic" && env.behavior !== "experimental") language = "sparse";

  const hr = harmonicRhythm(env.profile, env.controls, language);
  const out: ChordSlot[] = [];
  let deg = prevSlot && prevSlot.chord.degree >= 0 ? prevSlot.chord.degree % n : 0;
  let chromaRoot = key;
  // phrases sharing one long chord (harmonic rhythm longer than a phrase) are grouped
  const groups: Phrase[][] = [];
  const perGroup = Number.isFinite(hr) && hr > sec.phrases[0]?.bars ? Math.max(1, Math.round(hr / Math.max(1, sec.phrases[0].bars))) : 1;
  for (let i = 0; i < sec.phrases.length; i += language === "bordun" ? sec.phrases.length : perGroup) groups.push(sec.phrases.slice(i, i + (language === "bordun" ? sec.phrases.length : perGroup)));

  groups.forEach((group, gi) => {
    const start = group[0].startBar * bb;
    const bars = group.reduce((s, p) => s + p.bars, 0);
    const cadence = group[group.length - 1].cadence;
    const slots = Number.isFinite(hr) ? Math.max(1, Math.round(bars / Math.min(hr, bars))) : 1;
    const slotBeats = (bars * bb) / slots;
    const steps: Step[] = [];
    for (let i = 0; i < slots; i++) {
      const pos = i;
      const lastSlot = i === slots - 1;
      const penult = i === slots - 2;
      let st: Step;
      switch (language) {
        case "bordun":
          st = { deg: 0, func: "tonic", tension: 0 };
          break;
        case "drone": {
          const cols: Colour[] = ["plain", "sus2", "add9", "sus4", "plain"];
          st = { deg: 0, func: "tonic", tension: 0.1, colour: gi === 0 && i === 0 ? "plain" : lastSlot && cadence === "full" ? "plain" : r.pick(cols) };
          break;
        }
        case "shifting": {
          // rock tonic ↔ shift chord; the cadence decides which one the phrase lands on
          const onShift = pos % 2 === 1;
          let d = onShift ? shift : 0;
          if (lastSlot) d = cadence === "full" || cadence === "plagal" ? 0 : shift;
          if (slots === 1) d = cadence === "full" ? 0 : shift;
          st = { deg: d, func: d === 0 ? "tonic" : "colour", tension: d === 0 ? 0 : 0.35 };
          break;
        }
        case "modal":
        case "pedal": {
          const a = colours[0] ?? cad;
          const b = colours[1] ?? a;
          let d = pos % 2 === 0 ? 0 : pos % 4 === 3 || r.chance(0.25) ? b : a;
          if (lastSlot) d = cadence === "full" || cadence === "plagal" ? 0 : cadence === "deceptive" ? deceptiveDegree(key, scale, custom) : cad;
          if (penult && (cadence === "full" || cadence === "plagal")) d = cadence === "plagal" ? plagalDegree(key, scale, custom) : cad;
          st = { deg: d, func: language === "pedal" ? "pedal" : d === 0 ? "tonic" : d === cad ? "dominant" : "colour", tension: d === 0 ? 0 : d === cad ? 0.7 : 0.35 };
          break;
        }
        case "sparse": {
          if (i === 0 && gi === 0 && !prevSlot) d0();
          else {
            const prev = diatonicChord(deg, key, scale, 3, custom);
            const cand = usable.filter((d) => d !== deg);
            const w = cand.map((d) => {
              const c = diatonicChord(d, key, scale, 3, custom);
              const common = c.pcs.filter((pc) => prev.pcs.includes(pc)).length;
              return (common >= 2 ? 3 : common === 1 ? 1 : 0.2) * (d === 0 ? 1.4 : 1) * (c.quality === "dim" ? 0.2 : 1);
            });
            deg = cand.length ? r.weighted(cand, w) : 0;
          }
          if (lastSlot && cadence === "full") deg = 0;
          st = { deg, func: deg === 0 ? "tonic" : "colour", tension: deg === 0 ? 0 : 0.3 };
          break;
        }
        case "planing": {
          // one shape moving stepwise along the scale and back (nonfunctional parallel motion)
          const path = [0, 1, 2, 1, 0, -1, -2, -1];
          const dir = gi % 2 === 0 ? 1 : -1;
          const d = ((path[(pos + gi) % path.length] * dir) % n + n) % n;
          const dd = usable.includes(d) ? d : 0;
          st = { deg: lastSlot && cadence === "full" ? 0 : dd, func: "colour", tension: 0.4, colour: "quartal" };
          if (env.behavior === "experimental" && r.chance(0.25 + env.controls.dissonance * 0.5)) {
            // real (chromatic) planing: the tonic chord's exact shape moved to the degree's root
            const tonic = diatonicChord(0, key, scale, 3, custom);
            const rootPc = mod12(key + iv[st.deg]);
            const ivs = tonic.ivs ?? CHORD_FORMULAS[tonic.quality];
            const pcs = ivs.map((x) => mod12(rootPc + x));
            st.chord = { ...tonic, degree: st.deg, rootPc, pcs: [...new Set(pcs)], ivs };
          }
          break;
        }
        case "chromatic": {
          if (i > 0) {
            const moves = [3, -3, 4, -4, 1, -1];
            const w = [1, 1, 1, 1, env.controls.dissonance * 2, env.controls.dissonance * 2];
            chromaRoot = mod12(chromaRoot + r.weighted(moves, w));
          }
          if (lastSlot && cadence === "full") chromaRoot = key;
          const home = chromaRoot === key;
          const c = home ? diatonicChord(0, key, scale, size, custom) : chordFromQuality(chromaRoot, r.chance(0.5) ? "min" : "maj", iv.indexOf(mod12(chromaRoot - key)));
          st = { deg: Math.max(0, c.degree), func: home ? "tonic" : "chromatic", tension: home ? 0 : 0.6, chord: c };
          break;
        }
        default: {
          // functional: heptatonic scales walk the Markov chain toward their cadence; others move
          // by fourths and fifths between usable roots
          if (i === 0 && (gi === 0 || cadenceWasFull(out))) deg = 0;
          else {
            let row: number[];
            if (fam === "heptatonic") row = MARKOV[deg % 7].map((w, j) => (usable.includes(j) ? w : 0));
            else row = Array.from({ length: n }, (_, j) => (!usable.includes(j) || j === deg ? 0 : fifthRelated(iv[deg], iv[j]) ? 1 : 0.35));
            if (fam === "heptatonic" && scale !== "major" && scale !== "minor" && scale !== "harmonicMinor" && scale !== "melodicMinor") row[4] *= scale === "mixolydian" ? 0.6 : 0.2;
            if (row.every((x) => x <= 0)) row = row.map((_, j) => (usable.includes(j) ? 1 : 0));
            deg = r.weighted(row.map((_, j) => j), row);
          }
          if (lastSlot) deg = cadence === "full" || cadence === "plagal" ? 0 : cadence === "deceptive" ? deceptiveDegree(key, scale, custom) : cad;
          if (penult && (cadence === "full" || cadence === "plagal" || cadence === "deceptive")) deg = cadence === "plagal" ? plagalDegree(key, scale, custom) : cad;
          st = { deg, func: deg === 0 ? "tonic" : deg === cad ? "dominant" : "pre", tension: deg === 0 ? 0 : deg === cad ? 0.75 : 0.35 };
        }
      }
      if (language !== "sparse" && language !== "functional" && language !== "chromatic") deg = st.deg;
      steps.push(st);
    }

    // a locked melody steers the choice: each slot takes the usable chord that best contains the
    // melody's strong tones, unless the planned chord already does (cadence slots keep function)
    if (env.melodyWeight && language !== "bordun" && language !== "drone") {
      steps.forEach((st, i) => {
        const from = start + i * slotBeats;
        const wts = env.melodyWeight!(from, from + slotBeats);
        if (!wts.size) return;
        const cover = (c: Chord) => [...wts].reduce((s, [pc, w]) => s + (c.pcs.includes(pc) ? w : 0), 0);
        const total = [...wts.values()].reduce((a, b) => a + b, 0);
        const planned = st.chord ?? diatonicChord(st.deg, key, scale, size, custom);
        if (cover(planned) >= total * 0.6) return;
        const isCad = i >= slots - 2;
        const cands = isCad ? [...new Set([0, cad, plagalDegree(key, scale, custom), st.deg])] : usable;
        let best = st.deg;
        let bestS = -1;
        for (const d of cands) {
          const s = cover(diatonicChord(d, key, scale, size, custom)) + (d === st.deg ? total * 0.15 : 0);
          if (s > bestS) {
            bestS = s;
            best = d;
          }
        }
        st.deg = best;
        st.chord = undefined;
        st.func = best === 0 ? "tonic" : best === cad ? "dominant" : "colour";
      });
    }

    steps.forEach((st, i) => {
      let chord = st.chord ?? diatonicChord(st.deg, key, scale, language === "bordun" ? 3 : size, custom);
      if (!st.chord) {
        if (st.colour) chord = colourChord(chord, st.colour, sc);
        // expressive harmony borrows: iv or ♭VI in major, a Picardy-free raised V in minor cadences
        if (env.behavior !== "strict" && language === "functional" && st.func === "pre" && r.chance(env.controls.harmonicComplexity * 0.3)) {
          const borrowed = borrow(st.deg, key, scale, r);
          if (borrowed) chord = borrowed;
        }
        if (env.behavior !== "strict" && st.func === "dominant" && scale === "minor" && env.controls.harmonicComplexity > 0.55) {
          const v = chordFromQuality(chord.rootPc, size >= 4 ? "dom7" : "maj", st.deg);
          chord = v;
        }
      }
      const bassPc = language === "pedal" || language === "bordun" || language === "drone" ? key : chord.rootPc;
      const slotStart = start + i * slotBeats;
      // expressive suspension: a cadential dominant enters as sus4 and resolves halfway
      if (env.behavior !== "strict" && st.func === "dominant" && slotBeats >= bb && !st.chord && env.profile.id !== "traditional") {
        const sus = colourChord(chord, "sus4", sc);
        if (sus !== chord) {
          out.push({ start: slotStart, dur: slotBeats / 2, chord: sus, bassPc, func: "dominant", tension: Math.min(1, st.tension + 0.1), size });
          out.push({ start: slotStart + slotBeats / 2, dur: slotBeats / 2, chord, bassPc, func: "dominant", tension: st.tension, size });
          return;
        }
      }
      push(out, { start: slotStart, dur: slotBeats, chord, bassPc, func: st.func, tension: st.tension, size });
    });
  });

  // every chord states which of its tones lie outside the scale
  const scalePcs = iv.map((x) => mod12(key + x));
  return out.map((sl) => {
    const outside = sl.chord.pcs.filter((pc) => !scalePcs.includes(pc));
    const { outside: _drop, ...rest } = sl.chord;
    void _drop;
    return { ...sl, chord: outside.length ? { ...rest, outside } : rest };
  });

  function d0() {
    deg = 0;
  }
}

function cadenceWasFull(out: ChordSlot[]): boolean {
  const last = out[out.length - 1];
  return !last || last.func === "tonic";
}

/** Merge a slot into the previous one when it repeats the same chord over the same bass. */
function push(out: ChordSlot[], s: ChordSlot): void {
  const prev = out[out.length - 1];
  if (prev && prev.chord.rootPc === s.chord.rootPc && prev.chord.pcs.join() === s.chord.pcs.join() && prev.bassPc === s.bassPc && Math.abs(prev.start + prev.dur - s.start) < 1e-6) {
    prev.dur += s.dur;
    if (s.func === "tonic" || s.func === "dominant") prev.func = s.func;
    return;
  }
  out.push(s);
}

function fifthRelated(a: number, b: number): boolean {
  const d = mod12(b - a);
  return d === 5 || d === 7;
}

/** Modal mixture for a pre-dominant slot in a major-family key: iv, ♭VI or ♭VII. */
function borrow(deg: number, key: number, scale: ScaleId, r: Rng): Chord | null {
  if (scale !== "major" && scale !== "lydian" && scale !== "mixolydian") return null;
  const options: [number, "min" | "maj"][] = [[5, "min"], [8, "maj"], [10, "maj"]];
  const [semis, q] = r.pick(options);
  const c = chordFromQuality(mod12(key + semis), q, deg);
  return { ...c, degree: -1 };
}
