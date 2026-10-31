// FORM. A composition's large-scale shape is decided first: which sections exist, what each one
// does (introduce, state, contrast, develop, vary, peak, resolve, end), how long each is in whole
// phrases, how intense it is, and inside it the phrase plan — question phrases that end open (half
// cadence) answered by phrases that close on the tonic.
//
// Templates grow with length rather than stretching: a 256-bar rondo has more episodes and varied
// refrains, not 40-bar sections of the same thing.

import type { Rng } from "../theory/rng";
import { entries, getProfile, type Profile } from "./profiles";
import type { Cadence, ComposeControls, FormId, Phrase, PhraseKind, ProfileId, SectionFn } from "./types";

export interface SectionSkeleton {
  label: string;
  name: string;
  fn: SectionFn;
  theme: string | null;
  variant: number;
  intensity: number;
  startBar: number;
  bars: number;
  phrases: Phrase[];
}

interface Slot {
  letter: string | null;
  fn: SectionFn;
  weight: number;
  intensity: number;
  variant: number;
  name: string;
}

export const FORMS: { id: FormId; label: string; summary: string }[] = [
  { id: "rondo", label: "Rondo", summary: "A B A C A … — a refrain returning between contrasting episodes" },
  { id: "aba", label: "ABA (ternary)", summary: "Statement, contrast, varied return" },
  { id: "aaba", label: "AABA", summary: "Theme, varied theme, bridge, return" },
  { id: "arch", label: "Arch", summary: "A B C B′ A′ — symmetric around a central climax" },
  { id: "through", label: "Through-composed", summary: "Each section new, each derived from what came before" },
  { id: "binary", label: "Binary", summary: "A A′ B B′" },
  { id: "variations", label: "Theme & variations", summary: "A theme, then variations of growing distance, then the theme recalled" },
  { id: "process", label: "Process (minimalist)", summary: "Build-up, gradual processes, plateau, reduction" },
  { id: "canon", label: "Canon / round", summary: "A melody in canon, one more voice each time" },
];

const PRIME = ["", "′", "″", "‴"];
const prime = (v: number) => PRIME[Math.min(v, PRIME.length - 1)] ?? "";

const S = (letter: string | null, fn: SectionFn, weight: number, intensity: number, variant: number, name: string): Slot => ({ letter, fn, weight, intensity, variant, name });

/** Section slots for a form, grown to roughly `count` sections. */
function slotsFor(form: FormId, count: number, evolution: number): Slot[] {
  const n = Math.max(2, count);
  const dev = (k: number) => (evolution > 0.55 && k >= 2 ? 2 : 1);
  switch (form) {
    case "rondo": {
      const episodes = Math.max(1, Math.floor((n - 3) / 2));
      const out: Slot[] = [S(null, "intro", 0.4, 0.25, 0, "Introduction"), S("A", "theme", 1, 0.55, 0, "Refrain")];
      const letters = ["B", "C", "D", "E", "F"];
      for (let k = 0; k < episodes; k++) {
        const letter = letters[k % letters.length];
        const peak = k === episodes - 1 && episodes > 1;
        out.push(S(letter, peak ? "climax" : "contrast", 1, peak ? 0.85 : 0.62 + 0.06 * k, 0, peak ? "Episode (peak)" : "Episode"));
        const last = k === episodes - 1;
        out.push(S("A", last ? "climax" : "variation", 1, last ? 0.9 : 0.6 + 0.05 * k, Math.min(dev(k + 1), 1 + Math.floor(k / 2)), last ? "Refrain (tutti)" : "Refrain"));
      }
      out.push(S(null, "ending", 0.4, 0.3, 0, "Coda"));
      return out;
    }
    case "aba": {
      if (n <= 5) return [S(null, "intro", 0.4, 0.25, 0, "Introduction"), S("A", "theme", 1, 0.55, 0, "Statement"), S("B", "contrast", 1.1, 0.7, 0, "Contrast"), S("A", "climax", 1, 0.8, 1, "Return"), S(null, "ending", 0.4, 0.3, 0, "Coda")];
      return [S(null, "intro", 0.4, 0.25, 0, "Introduction"), S("A", "theme", 1, 0.5, 0, "Statement"), S("A", "variation", 0.8, 0.6, 1, "Statement (varied)"),
        S("B", "contrast", 1.1, 0.65, 0, "Contrast"), S("A", "development", 1, 0.75, 2, "Development"), S("A", "climax", 1, 0.9, 1, "Return"), S(null, "ending", 0.45, 0.3, 0, "Coda")];
    }
    case "aaba": {
      const base = [S("A", "theme", 1, 0.5, 0, "Theme"), S("A", "variation", 1, 0.6, 1, "Theme (varied)"), S("B", "contrast", 1, 0.7, 0, "Bridge"), S("A", "resolution", 1, 0.7, 1, "Return")];
      if (n <= 5) return [...base, S(null, "ending", 0.35, 0.3, 0, "Tag")];
      return [...base, S("B", "development", 1, 0.8, 2, "Bridge (developed)"), S("A", "climax", 1, 0.9, 2, "Return (tutti)"), S(null, "ending", 0.4, 0.3, 0, "Tag")];
    }
    case "arch": {
      const half = Math.max(2, Math.ceil(n / 2));
      const letters = ["A", "B", "C", "D", "E"].slice(0, half);
      const out: Slot[] = letters.map((l, i) => {
        const centre = i === letters.length - 1;
        return S(l, centre ? "climax" : i === 0 ? "theme" : "contrast", centre ? 1.2 : 1, 0.4 + (0.5 * i) / Math.max(1, letters.length - 1), 0, centre ? "Centre" : i === 0 ? "Opening" : "Ascent");
      });
      for (let i = letters.length - 2; i >= 0; i--) out.push(S(letters[i], i === 0 ? "ending" : "resolution", 1, 0.35 + (0.45 * i) / Math.max(1, letters.length - 1), 1, i === 0 ? "Closing" : "Descent"));
      return out;
    }
    case "through": {
      const letters = ["A", "B", "C", "D", "E", "F", "G", "H"];
      const k = Math.max(3, Math.min(letters.length, n));
      return letters.slice(0, k).map((l, i) => {
        const t = i / (k - 1);
        const fn: SectionFn = i === 0 ? "theme" : i === k - 1 ? "ending" : t > 0.55 && t < 0.8 ? "climax" : i % 2 ? "development" : "contrast";
        const intensity = i === k - 1 ? 0.3 : 0.4 + 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.25));
        return S(l, fn, 1, intensity, 0, fn === "climax" ? "Peak" : fn === "ending" ? "Epilogue" : i === 0 ? "Opening" : fn === "development" ? "Development" : "New material");
      });
    }
    case "binary": {
      const out = [S("A", "theme", 1, 0.5, 0, "First strain"), S("A", "variation", 1, 0.6, 1, "First strain (varied)"), S("B", "contrast", 1, 0.7, 0, "Second strain"), S("B", "climax", 1, 0.85, 1, "Second strain (varied)")];
      if (n > 5) out.push(S("A", "variation", 1, 0.75, 2, "First strain (developed)"), S("B", "resolution", 1, 0.6, 2, "Second strain (developed)"));
      out.push(S(null, "ending", 0.35, 0.3, 0, "Coda"));
      return out;
    }
    case "variations": {
      const vars = Math.max(2, n - 2);
      const out: Slot[] = [S("A", "theme", 1, 0.45, 0, "Theme")];
      for (let v = 1; v <= vars; v++) {
        const t = v / vars;
        out.push(S("A", t > 0.7 && t < 1 ? "climax" : "variation", 1, 0.5 + 0.4 * Math.sin(Math.PI * Math.min(1, t * 0.9)), v >= 2 ? 2 : 1, `Variation ${v}`));
      }
      out.push(S("A", "ending", 0.8, 0.4, 0, "Theme (recalled)"));
      return out;
    }
    case "process": {
      const steps = Math.max(2, n - 3);
      const out: Slot[] = [S(null, "intro", 0.6, 0.3, 0, "Build-up")];
      for (let k = 0; k < steps; k++) out.push(S("A", "development", 1, 0.45 + (0.35 * (k + 1)) / steps, Math.min(2, 1 + Math.floor(k / 2)), `Process ${k + 1}`));
      out.push(S("A", "climax", 1, 0.9, 2, "Plateau"), S("A", "ending", 0.7, 0.35, 1, "Reduction"));
      return out;
    }
    case "canon": {
      const entries = Math.max(2, Math.min(5, n - 2));
      const out: Slot[] = [S(null, "intro", 0.4, 0.25, 0, "Bordun introduction")];
      for (let v = 0; v < entries; v++) out.push(S("A", v === entries - 1 ? "climax" : v === 0 ? "theme" : "variation", 1, 0.5 + (0.4 * v) / Math.max(1, entries - 1), v === 0 ? 0 : 1, v === 0 ? "Melody alone" : `Canon in ${v + 1}`));
      out.push(S(null, "ending", 0.4, 0.3, 0, "Coda"));
      return out;
    }
  }
}

/** Choose a form for a profile and length when the user leaves it on Auto. */
export function autoForm(profileId: ProfileId, bars: number, r: Rng): FormId {
  const p = getProfile(profileId);
  const { items, weights } = entries(p.forms);
  // short pieces prefer compact forms; long ones the forms that grow gracefully
  const w = items.map((f, i) => {
    let x = weights[i];
    if (bars <= 24 && (f === "rondo" || f === "variations" || f === "arch")) x *= 0.3;
    if (bars >= 128 && (f === "rondo" || f === "variations" || f === "through" || f === "process")) x *= 1.6;
    return x;
  });
  return r.weighted(items, w);
}

/** Plan the sections of a piece: slots grown to the length, bars allocated in whole phrases,
 *  intensities shaped by the evolution control, and each section's phrase plan. */
export function planForm(form: FormId, bars: number, profile: Profile, controls: ComposeControls, r: Rng): SectionSkeleton[] {
  const P = profile.phraseBars;
  const totalPhrases = Math.max(1, Math.floor(bars / P));
  const target = Math.max(2, Math.round(bars / profile.sectionBars));
  let slots = slotsFor(form, Math.min(target, Math.max(2, totalPhrases)), controls.evolution);
  // too short for every section to get a phrase: drop introduction/coda first, then trim from the end
  while (slots.length > totalPhrases && slots.some((s) => s.fn === "intro" || s.fn === "ending")) {
    const i = slots.findIndex((s) => s.fn === "intro");
    slots.splice(i >= 0 ? i : slots.findIndex((s) => s.fn === "ending"), 1);
  }
  if (slots.length > totalPhrases) slots = slots.slice(0, totalPhrases);

  // whole phrases per section, proportional to weight (every section ≥ 1)
  const W = slots.reduce((s, x) => s + x.weight, 0);
  const phrases = slots.map((s) => Math.max(1, Math.floor((totalPhrases * s.weight) / W)));
  let left = totalPhrases - phrases.reduce((a, b) => a + b, 0);
  const order = slots.map((s, i) => ({ i, w: s.weight - (s.fn === "intro" || s.fn === "ending" ? 0.6 : 0) })).sort((a, b) => b.w - a.w || a.i - b.i);
  for (let k = 0; left > 0; k++, left--) phrases[order[k % order.length].i]++;
  // themes want an even number of phrases (question + answer) where that is possible
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].letter && phrases[i] % 2 === 1 && phrases[i] > 1) {
      const j = slots.findIndex((s, k) => k !== i && phrases[k] % 2 === 1 && phrases[k] > 1 && s.letter);
      if (j >= 0) {
        phrases[i]++;
        phrases[j]--;
      }
    }
  }

  const remainder = bars - totalPhrases * P;
  const out: SectionSkeleton[] = [];
  let bar = 0;
  const count = slots.length;
  slots.forEach((s, i) => {
    const extra = i === count - 1 ? remainder : 0;
    const secBars = phrases[i] * P + extra;
    // the evolution control bends the template's intensities toward a single arc peaking late
    const t = count > 1 ? i / (count - 1) : 0;
    const arc = 0.3 + 0.62 * Math.sin(Math.PI * Math.min(1, t * 1.3));
    const shaped = clamp01(s.intensity * (1 - controls.evolution * 0.45) + arc * controls.evolution * 0.45 + (r() - 0.5) * 0.04);
    const [dLo, dHi] = profile.dynamics;
    const intensity = dLo + (dHi - dLo) * shaped;
    const label = s.letter ? s.letter + prime(s.variant > 0 ? countPrior(out, s.letter) : 0) : s.fn === "intro" ? "Intro" : "Coda";
    out.push({ label, name: s.name, fn: s.fn, theme: s.letter, variant: s.variant, intensity, startBar: bar, bars: secBars, phrases: [] });
    bar += secBars;
  });
  out.forEach((sec, i) => (sec.phrases = phrasePlan(sec, out[i + 1] ?? null, P, i === out.length - 1)));
  return out;
}

function countPrior(out: SectionSkeleton[], letter: string): number {
  return out.filter((s) => s.theme === letter).length;
}

/** Phrases inside a section. Themes pair question (half cadence) with answer (full); development
 *  spins continuation phrases that stay open; a section leading back to a refrain ends on a half
 *  cadence (retransition); the last phrase of the piece closes on the tonic. */
export function phrasePlan(sec: Pick<SectionSkeleton, "fn" | "bars" | "startBar" | "theme">, next: Pick<SectionSkeleton, "theme" | "fn"> | null, P: number, last: boolean): Phrase[] {
  const out: Phrase[] = [];
  let b = 0;
  let k = 0;
  while (b < sec.bars) {
    const len = Math.min(P, sec.bars - b) || P;
    // a short tail (< half a phrase) joins the previous phrase rather than standing alone
    if (len < P && len < P / 2 && out.length) {
      out[out.length - 1].bars += len;
      break;
    }
    let kind: PhraseKind;
    let cadence: Cadence;
    if (sec.fn === "intro") {
      kind = "free";
      cadence = "open";
    } else if (sec.fn === "development") {
      kind = "continuation";
      cadence = k % 2 === 0 ? "open" : "half";
    } else if (sec.fn === "ending") {
      kind = "statement";
      cadence = sec.theme ? (k % 2 === 0 ? "half" : "full") : "full";
    } else {
      kind = k % 2 === 0 ? "question" : "answer";
      cadence = kind === "question" ? "half" : "full";
    }
    out.push({ startBar: sec.startBar + b, bars: len, cadence, kind });
    b += len;
    k++;
  }
  const end = out[out.length - 1];
  if (end) {
    const leadsToReturn = next && next.theme === "A" && sec.theme !== "A" && sec.fn !== "intro";
    if (last) end.cadence = "full";
    else if (leadsToReturn) end.cadence = "half";
    else if (sec.fn === "contrast" && end.kind === "answer") end.cadence = next?.fn === "climax" ? "half" : "full";
    // a deceptive cadence once in a while delays a section's close (developing forms only)
    if (!last && sec.fn === "climax" && out.length >= 4) out[out.length - 3].cadence = "deceptive";
  }
  return out;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
