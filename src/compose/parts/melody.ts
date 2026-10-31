// PRIMARY MELODY. The carrier develops the section's theme phrase by phrase. Each phrase is a plan
// of theme statements (APERTURE planPhrase: period, sentence, cell, call, drone, theme forms)
// realised on the shared harmony (APERTURE realiseUnit: chord tones where the music is exposed,
// non-chord tones only as passing or neighbour notes). What this writer adds for elemental music:
//
//  • cadences belong to the form: a question phrase ends open, an answer closes on the tonic, and
//    over a static bordun — where there is no dominant chord — the half cadence is melodic: the
//    line comes to rest on re or sol (the 2nd or 5th degree);
//  • varied repetition (A′) ornaments and substitutes notes but keeps rhythm and contour, while
//    development (variant 2) fragments the theme and sequences it, inverts or augments it;
//  • the climax lifts the line into a higher register; phrase endings breathe;
//  • when a follower will echo, each phrase leaves its last statement's worth of silence.

import { slotAt, stablePcs } from "../../theory/context";
import { type Motif, chordAnchor, displace, fragment, invert, ornament, planPhrase, realiseUnit, scaleTime, substitute } from "../../theory/motif";
import { scaleIntervals } from "../../theory/scales";
import type { Beats } from "../../theory/types";
import type { Cadence, Draft, Phrase } from "../types";
import { degreeFrame, draft, mod12, type PartEnv, phraseEnd, phraseStart } from "./common";

export interface MelodyOptions {
  echoGap: boolean;
  /** only write phrases accepted by the filter (call-and-response splits phrases between parts) */
  phraseFilter?: (p: Phrase, index: number) => boolean;
}

/** Pitch classes a phrase may end on for its cadence. */
export function cadenceTargets(env: Pick<PartEnv, "ctx" | "sec"> & { profileId?: string }, beat: Beats, cadence: Cadence): number[] {
  const { ctx } = env;
  const slot = slotAt(ctx, beat);
  const key = env.sec.key;
  const st = stablePcs(slot);
  const iv = scaleIntervals(env.sec.scale, ctx.custom);
  const tonicHarmony = slot.chord.rootPc === mod12(key) || slot.func === "tonic" || slot.func === "pedal";
  switch (cadence) {
    case "full":
    case "plagal":
      return slot.chord.pcs.includes(mod12(key)) ? [mod12(key)] : st.slice(0, 1);
    case "half": {
      if (tonicHarmony) {
        // melodic half cadence over the tonic: sol (in the bordun's fifth), or — in elemental
        // pieces, where the open second is idiomatic — re
        const re = iv[1] !== undefined && env.profileId === "traditional" ? mod12(key + iv[1]) : null;
        const sol = iv.includes(7) ? mod12(key + 7) : null;
        const t = [sol, re].filter((x): x is number => x !== null);
        return t.length ? t : st.filter((pc) => pc !== mod12(key));
      }
      const nonTonic = st.filter((pc) => pc !== mod12(key));
      return nonTonic.length ? nonTonic : st;
    }
    case "deceptive":
      return st.filter((pc) => pc !== mod12(key)).slice(0, 2);
    default: {
      const t = st.filter((pc) => pc !== mod12(key));
      return t.length ? t : st;
    }
  }
}

/** Move a phrase's final note to the nearest pitch that makes its cadence, approached by step
 *  where possible. */
export function landCadence(env: Pick<PartEnv, "ctx" | "sec" | "lo" | "hi" | "profile">, midi: number, prev: number | undefined, beat: Beats, cadence: Cadence): number {
  const targets = cadenceTargets({ ...env, profileId: env.profile.id }, beat, cadence);
  if (!targets.length || targets.includes(mod12(midi))) return midi;
  let best = midi;
  let bd = Infinity;
  for (let m = env.lo; m <= env.hi; m++) {
    if (!targets.includes(mod12(m))) continue;
    const step = prev !== undefined ? Math.abs(m - prev) : 0;
    // later targets are second choices (re after sol in a melodic half cadence)
    const d = Math.abs(m - midi) + (step > 5 ? (step - 5) * 0.6 : 0) + targets.indexOf(mod12(m)) * 2.5;
    if (d < bd) {
      bd = d;
      best = m;
    }
  }
  return best;
}

export function writeMelody(env: PartEnv, themeId: string, opts: MelodyOptions): Draft[] {
  const theme = env.themes[themeId];
  if (!theme) return [];
  const { ctx, sec, bb, controls, profile } = env;
  const f = degreeFrame(env);
  const out: Draft[] = [];
  const unitBeats = theme.bars * bb;
  const motifSpan = theme.motif.span;
  const span = Math.round(4 + profile.motif.range * 0.75 + controls.motifVariation * 2);
  const climax = sec.fn === "climax";
  const centreMidi = env.lo + (env.hi - env.lo) * (climax ? 0.62 : 0.48);
  let centre = f.toDeg(Math.round(centreMidi));
  const lo = Math.max(f.loDeg, centre - Math.floor(span / 2));
  const hi = Math.min(f.hiDeg, lo + span);
  centre = Math.round((lo + hi) / 2);
  const form = sec.variant === 2 && profile.phraseForm !== "cell" ? "sentence" : profile.phraseForm;
  let anchor = chordAnchor(ctx, centre - 1, env.start, f.base, lo + 1, hi - 2);
  let prevMidi: number | undefined = env.memory.lastPitch;

  sec.phrases.forEach((ph, pi) => {
    if (opts.phraseFilter && !opts.phraseFilter(ph, pi)) return;
    const pStart = phraseStart(ph, bb);
    const pEnd = phraseEnd(ph, bb);
    if (pStart < env.start + env.part.enterBar * bb - 1e-6) return;
    const units = Math.max(1, Math.round((ph.bars * bb) / unitBeats));
    const writeUnits = opts.echoGap && units >= 2 ? units - 1 : units;
    // the statement itself comes from the theme's own stream; development re-rolls it, and the
    // variation decisions (what to ornament, what to leave out) come from the section's stream
    const statementR = sec.variant === 2 ? env.r.fork(`phrase:${pi}`) : env.themeRng(themeId, `phrase:${pi}:${opts.echoGap ? "e" : ""}`);
    const r = env.r.fork(`vary:${pi}`);
    const plan = planPhrase(form, theme.motif, writeUnits, pi, statementR.fork("plan"), {
      stage: sec.index / Math.max(1, env.plan.sections.length - 1),
      variant: 0,
      mutation: controls.motifVariation * (profile.process === "minimal" ? 1 : 0.6),
      grid: 0.5,
      expressive: ctx.behavior !== "strict",
    });
    const cad: "half" | "full" = ph.cadence === "full" || ph.cadence === "plagal" ? "full" : "half";
    // an augmented statement occupies the units after it; they are not written over it
    let busyUntil = -Infinity;
    plan.forEach((u, k) => {
      const uStart = pStart + k * unitBeats;
      if (uStart >= pEnd - 1e-6 || uStart < busyUntil - 1e-6) return;
      const lastUnit = k === writeUnits - 1;
      let m: Motif = u.motif;
      // intentional silence: statements left out (never the cadence) in spacious profiles
      if (!lastUnit && k > 0 && r.chance(profile.silence * 0.6 * (1.3 - sec.intensity))) return;
      // varied repetition keeps rhythm and contour, ornaments or substitutes a note
      // (the section's opening statement stays literal: it is what makes a return recognisable)
      const opening = pi === 0 && k === 0;
      if (sec.variant === 1 && !lastUnit && !opening && r.chance(0.25 + controls.motifVariation * 0.5)) m = r.chance(0.5) ? ornament(m) : substitute(m, r);
      // development: fragments in sequence, inversion, augmentation, displacement
      if (sec.variant === 2) {
        if (k > 0 && !lastUnit && r.chance(0.5)) m = fragment(m, Math.max(2, Math.ceil(m.notes.length / 2)));
        if (r.chance(controls.motifVariation * 0.35)) m = invert(m);
        if (profile.id === "experimental" && r.chance(0.4)) m = displace(m, 0.5);
      }
      if (climax && k === 0 && profile.id === "cinematic" && r.chance(0.5) && m.span * 2 <= unitBeats * Math.max(1, writeUnits - 1) + 1e-6) m = scaleTime(m, 2);
      if (m.span < motifSpan - 1e-6 && lastUnit) m = { ...m, span: motifSpan };
      const mn = Math.min(0, ...m.notes.map((x) => x.step));
      const mx = Math.max(0, ...m.notes.map((x) => x.step));
      const aLo = lo - mn;
      const aHi = hi - mx;
      const shift = u.shift + (sec.variant === 2 && k > 0 ? k : 0);
      anchor = chordAnchor(ctx, anchor + shift, uStart, f.base, Math.min(aLo, aHi), Math.max(aLo, aHi));
      const phraseLimit = opts.echoGap && units >= 2 ? pStart + writeUnits * unitBeats : pEnd;
      busyUntil = uStart + Math.max(unitBeats, Math.ceil(m.span / unitBeats - 1e-6) * unitBeats);
      const limit = lastUnit ? phraseLimit : Math.min(phraseLimit, busyUntil);
      const notes = realiseUnit(ctx, { motif: m, start: uStart, anchor, base: f.base, lo, hi, cadence: lastUnit ? cad : "none", vel: 0.8, rng: statementR.fork(`unit:${k}`), end: limit, chromatic: env.controls.dissonance * 0.4 });
      notes.forEach((x, i) => {
        let midi = Math.round(x.midi);
        const isFinal = lastUnit && i === notes.length - 1;
        let dur = x.dur;
        if (isFinal) {
          midi = landCadence(env, midi, prevMidi, x.beat, ph.cadence);
          // the cadence note sustains to the end of the phrase, leaving a breath
          const breath = Math.min(1, bb / 4) * (profile.id === "ambient" ? 2 : 1);
          dur = Math.max(dur, phraseLimit - x.beat - breath);
        }
        out.push(draft(x.beat, Math.min(dur, (isFinal ? phraseLimit : limit) - x.beat), midi, x.vel, isFinal ? "cadence" : u.label.split(" ")[0], theme.id));
        prevMidi = midi;
      });
      if (lastUnit && opts.echoGap && units >= 2) env.shared.echoUnits.push({ from: uStart, to: uStart + unitBeats, cadence: ph.cadence, phraseEnd: pEnd });
    });
  });
  env.memory.lastPitch = prevMidi;
  return out;
}
