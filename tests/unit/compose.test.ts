import { describe, expect, it } from "vitest";
import { analyse } from "../../src/compose/analysis";
import { compose, defaultSettings, seedsFrom } from "../../src/compose/composer";
import { ensembleInfo, instrumentRange } from "../../src/compose/instruments";
import { PROFILE_IDS } from "../../src/compose/profiles";
import type { ComposeSettings, Composition, ProfileId } from "../../src/compose/types";
import { barBeats } from "../../src/theory/meter";

const make = (profile: ProfileId, instruments: number, seed: number, extra: Partial<ComposeSettings> = {}) =>
  compose({ settings: { ...defaultSettings(), profile, instruments, bars: 64, ...extra }, seeds: seedsFrom(seed) }).composition;

const strictish = (p: ProfileId) => p !== "experimental";

describe("determinism", () => {
  it("identical seeds and settings produce identical compositions (every profile)", () => {
    for (const p of PROFILE_IDS) expect(JSON.stringify(make(p, 8, 99))).toBe(JSON.stringify(make(p, 8, 99)));
  });
  it("different seeds produce different music", () => {
    const a = make("traditional", 6, 1).tracks.flatMap((t) => t.notes.map((n) => n.midi));
    const b = make("traditional", 6, 2).tracks.flatMap((t) => t.notes.map((n) => n.midi));
    expect(a.join()).not.toBe(b.join());
  });
  it("humanisation changes timing and velocity, never the pitches or the plan", () => {
    const a = make("cinematic", 8, 5, { controls: { ...defaultSettings().controls, humanize: 0 } });
    const b = make("cinematic", 8, 5, { controls: { ...defaultSettings().controls, humanize: 1 } });
    expect(JSON.stringify(a.plan)).toBe(JSON.stringify(b.plan));
    for (let i = 0; i < a.tracks.length; i++) expect(b.tracks[i].notes.map((n) => n.midi)).toEqual(a.tracks[i].notes.map((n) => n.midi));
    expect(b.tracks[0].notes.some((n, i) => Math.abs(n.start - a.tracks[0].notes[i].start) > 1e-4)).toBe(true);
  });
});

describe("ensembles of 4, 6, 8 and 12 instruments in every profile", () => {
  for (const p of PROFILE_IDS) {
    for (const n of [4, 6, 8, 12]) {
      it(`${p} × ${n}`, () => {
        const c = make(p, n, 17 + n);
        const a = analyse(c);
        expect(c.tracks).toHaveLength(n);
        const bb = barBeats(c.plan.meter);
        // notes are valid, inside the piece, inside each instrument's playable range
        for (const t of c.tracks) {
          const [lo, hi] = instrumentRange(t.instrumentId, "orff");
          for (const x of t.notes) {
            expect(Number.isFinite(x.start) && Number.isFinite(x.dur) && Number.isFinite(x.midi)).toBe(true);
            expect(x.midi).toBeGreaterThanOrEqual(lo);
            expect(x.midi).toBeLessThanOrEqual(hi);
            expect(x.vel).toBeGreaterThan(0);
            expect(x.vel).toBeLessThanOrEqual(1);
            expect(x.start).toBeLessThan(c.plan.bars * bb);
          }
        }
        // harmonic agreement and consonance
        expect(a.chordToneStrong).toBeGreaterThan(strictish(p) ? 0.8 : 0.75);
        if (c.plan.behavior === "strict") expect(a.outOfScale).toBe(0);
        expect(a.clashesPer100).toBeLessThan(p === "experimental" ? 3 : 1.5);
        // the ensemble does not play all the time
        if (n >= 6) {
          expect(a.meanActive).toBeLessThan(n * 0.9);
          // (a climax is a tutti by design; elsewhere parts rest)
          expect(a.tuttiBars).toBeLessThan(0.4);
        }
        expect(Math.max(...Object.values(a.silence))).toBeGreaterThan(0.1);
        // structure: cadences land, textures change between sections
        expect(a.cadenceAccuracy).toBeGreaterThan(0.95);
        if (n >= 4 && c.plan.sections.length >= 3) expect(a.distinctTextures).toBeGreaterThanOrEqual(2);
      });
    }
  }
});

describe("lengths", () => {
  it("16 to 256 bars, all filled to the end", () => {
    for (const bars of [16, 32, 64, 128, 256]) {
      const c = make("traditional", 6, 3, { bars });
      expect(c.plan.bars).toBe(bars);
      expect(c.plan.sections.reduce((s, x) => s + x.bars, 0)).toBe(bars);
      const bb = barBeats(c.plan.meter);
      const last = Math.max(...c.tracks.flatMap((t) => t.notes.map((n) => n.start)));
      expect(last).toBeGreaterThan((bars - 2) * bb);
    }
  });
  it("long pieces grow more sections rather than longer ones", () => {
    const short = make("traditional", 6, 4, { bars: 32, form: "rondo" });
    const long = make("traditional", 6, 4, { bars: 256, form: "rondo" });
    expect(long.plan.sections.length).toBeGreaterThan(short.plan.sections.length + 4);
    expect(Math.max(...long.plan.sections.map((s) => s.bars))).toBeLessThanOrEqual(40);
  });
  it("a duration becomes a bar count at the chosen tempo", () => {
    const c = make("minimal", 4, 5, { lengthMode: "duration", seconds: 120, bpm: 120, meter: "4/4" });
    expect(c.plan.bars).toBe(60);
  });
});

describe("phrases and cadences", () => {
  it("question phrases end open, answer phrases close on the tonic", () => {
    const c = make("traditional", 8, 21, { form: "aba" });
    const bb = barBeats(c.plan.meter);
    let checked = 0;
    for (const sec of c.plan.sections) {
      if (!sec.carrier) continue;
      const line = c.tracks.find((t) => t.id === sec.carrier)!.notes;
      for (const ph of sec.phrases) {
        const end = (ph.startBar + ph.bars) * bb;
        const cad = line.filter((n) => n.tag === "cadence" && n.start >= ph.startBar * bb && n.start < end);
        if (!cad.length) continue;
        const last = cad[cad.length - 1];
        checked++;
        // phrase endings breathe: the cadence note ends before the next phrase begins
        expect(last.start + last.dur).toBeLessThanOrEqual(end + 0.01);
        if (ph.cadence === "full") expect(((last.midi % 12) + 12) % 12).toBe(sec.key);
        if (ph.cadence === "half") expect(((last.midi % 12) + 12) % 12).not.toBe(sec.key);
      }
    }
    expect(checked).toBeGreaterThan(4);
  });
});

describe("motif continuity and structural variation", () => {
  it("returns resemble their first statement more than contrasting themes resemble it", () => {
    let ret = 0;
    let con = 0;
    let n = 0;
    for (const p of ["traditional", "cinematic", "polyrhythmic", "ambient"] as const) {
      for (const seed of [3, 8, 13]) {
        const a = analyse(make(p, 8, seed, { form: p === "ambient" ? "arch" : "aba" }));
        ret += a.returnSimilarity;
        con += a.contrastSimilarity;
        n++;
      }
    }
    expect(ret / n).toBeGreaterThan(con / n + 0.2);
    expect(ret / n).toBeGreaterThan(0.45);
  });
  it("sections differ in intensity, density and who plays", () => {
    const c = make("cinematic", 10, 6, { bars: 96 });
    const a = analyse(c);
    const ints = c.plan.sections.map((s) => s.intensity);
    expect(Math.max(...ints) - Math.min(...ints)).toBeGreaterThan(0.25);
    expect(a.densityVariation).toBeGreaterThan(0.1);
    expect(a.distinctTextures).toBeGreaterThanOrEqual(3);
  });
  it("instruments enter and leave: some part is tacet in some section, and introductions build up", () => {
    const c = make("traditional", 8, 12, { form: "rondo", bars: 96 });
    const tacet = c.plan.sections.some((s) => Object.values(s.parts).some((p) => !p.technique));
    expect(tacet).toBe(true);
    const intro = c.plan.sections.find((s) => s.fn === "intro");
    if (intro && intro.phrases.length > 1) expect(Object.values(intro.parts).some((p) => p.technique && p.enterBar > 0)).toBe(true);
  });
});

describe("profiles change the algorithm, not just the sound", () => {
  const tagsOf = (c: Composition) => new Set(c.tracks.flatMap((t) => t.notes.map((n) => (n.tag ?? "").replace(/\d+$/, ""))));
  it("Traditional writes borduns; Minimal writes additive and phased ostinatos; Polyrhythmic writes cycle ostinatos", () => {
    expect([...tagsOf(make("traditional", 8, 2))].some((t) => t.startsWith("bordun-"))).toBe(true);
    const min = tagsOf(make("minimal", 8, 2));
    expect(min.has("ostinato-additive")).toBe(true);
    expect([...min].some((t) => t.startsWith("ostinato-phase"))).toBe(true);
    const poly = make("polyrhythmic", 8, 2);
    const cycles = new Set(poly.tracks.flatMap((t) => t.notes.map((n) => n.tag ?? "").filter((x) => x.startsWith("ostinato-cycle"))));
    expect(cycles.size).toBeGreaterThanOrEqual(2);
  });
  it("Ambient is sparse and slow; Experimental leaves the scale on purpose", () => {
    const amb = make("ambient", 8, 9);
    const trad = make("traditional", 8, 9);
    const perBar = (c: Composition) => c.tracks.reduce((s, t) => s + t.notes.length, 0) / c.plan.bars;
    expect(perBar(amb)).toBeLessThan(perBar(trad) * 0.6);
    expect(amb.plan.bpm).toBeLessThanOrEqual(80);
    const exp = make("experimental", 8, 9);
    expect(analyse(exp).outOfScale).toBeGreaterThan(0);
    expect(["7/8", "5/8", "5/4", "9/8", "4/4"]).toContain(exp.plan.meter);
  });
  it("Orff realism limits mallets and striking speed; extended range does not", () => {
    const c = make("minimal", 8, 4, { realism: "orff" });
    const bb = barBeats(c.plan.meter);
    for (const t of c.tracks) {
      const info = ensembleInfo(t.instrumentId);
      const byStart = new Map<number, number>();
      for (const n of t.notes) byStart.set(Math.round(n.start * 48), (byStart.get(Math.round(n.start * 48)) ?? 0) + 1);
      expect(Math.max(...byStart.values())).toBeLessThanOrEqual(info.mallets);
      const starts = [...new Set(t.notes.map((n) => Math.round(n.start * 1000) / 1000))].sort((a, b) => a - b);
      const gap = (info.minGap * c.plan.bpm) / 60;
      for (let i = 1; i < starts.length; i++) expect(starts[i] - starts[i - 1]).toBeGreaterThan(gap - 0.05);
    }
    void bb;
  });
});
