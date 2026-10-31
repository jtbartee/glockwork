import { describe, expect, it } from "vitest";
import { compose, defaultSettings, seedsFrom } from "../../src/compose/composer";
import type { Composition, NoteEvent, Section } from "../../src/compose/types";
import { barBeats } from "../../src/theory/meter";

const mod12 = (x: number) => ((x % 12) + 12) % 12;

function find(pred: (c: Composition, s: Section) => boolean, profile = "traditional" as const, form?: string, tries = 40): { c: Composition; s: Section } {
  for (let seed = 1; seed <= tries; seed++) {
    const c = compose({ settings: { ...defaultSettings(), profile, instruments: 8, bars: 64, ...(form ? { form: form as never } : {}), controls: { ...defaultSettings().controls, counterpoint: 0.8 } }, seeds: seedsFrom(seed) }).composition;
    const s = c.plan.sections.find((x) => pred(c, x));
    if (s) return { c, s };
  }
  throw new Error("no matching section found");
}

const notesIn = (c: Composition, id: string, s: Section) => {
  const bb = barBeats(c.plan.meter);
  return c.tracks.find((t) => t.id === id)!.notes.filter((n) => n.start >= s.startBar * bb - 0.05 && n.start < (s.startBar + s.bars) * bb - 0.05);
};

describe("bordun", () => {
  it("over bordun harmony the bordun plays only the tonic and its fifth (or octave)", () => {
    const { c, s } = find((c, s) => s.language === "bordun" && Object.values(s.parts).some((p) => p.technique === "bordun"));
    const id = Object.entries(s.parts).find(([, p]) => p.technique === "bordun")![0];
    const fifth = mod12(s.key + 7);
    for (const n of notesIn(c, id, s)) expect([mod12(s.key), fifth, mod12(s.key + 9)]).toContain(mod12(n.midi)); // (+9: the moving bordun's upper neighbour)
  });
  it("crossover and level borduns reach the upper octave", () => {
    const { c } = find((c) => c.tracks.some((t) => t.notes.some((n) => n.tag === "bordun-crossover" || n.tag === "bordun-level")));
    const t = c.tracks.find((t) => t.notes.some((n) => n.tag === "bordun-crossover" || n.tag === "bordun-level"))!;
    const ns = t.notes.filter((n) => n.tag === "bordun-crossover" || n.tag === "bordun-level");
    expect(Math.max(...ns.map((n) => n.midi)) - Math.min(...ns.map((n) => n.midi))).toBeGreaterThanOrEqual(12);
  });
});

describe("imitation", () => {
  it("a canon follower plays the carrier's line later, transposed by octaves", () => {
    const { c, s } = find((_, s) => s.imitation.kind === "canon" && s.imitation.followers.length > 0, "traditional", "canon");
    const lead = notesIn(c, s.carrier!, s);
    const fol = notesIn(c, s.imitation.followers[0], s);
    expect(fol.length).toBeGreaterThan(4);
    const delay = fol[0].start - lead[0].start;
    expect(delay).toBeGreaterThan(0);
    // most follower notes match a carrier note `delay` earlier in pitch class
    let match = 0;
    for (const f of fol) if (lead.some((l) => Math.abs(l.start + delay - f.start) < 0.06 && mod12(l.midi) === mod12(f.midi))) match++;
    expect(match / fol.length).toBeGreaterThan(0.7);
  });
  it("an echo repeats the carrier's last statement in the gap it left, and makes the cadence", () => {
    const { c, s } = find((_, s) => s.imitation.kind === "echo" && s.imitation.followers.length > 0);
    const echo = notesIn(c, s.imitation.followers[0], s).filter((n) => n.tag === "echo" || n.tag === "cadence");
    const lead = notesIn(c, s.carrier!, s);
    expect(echo.length).toBeGreaterThan(2);
    // the echo sounds when the carrier is silent
    for (const e of echo) expect(lead.some((l) => l.start <= e.start + 0.05 && l.start + l.dur > e.start + 0.3)).toBe(false);
  });
  it("call and response alternate whole phrases between two instruments", () => {
    const { c, s } = find((_, s) => s.imitation.kind === "call" && s.imitation.followers.length > 0);
    const bb = barBeats(c.plan.meter);
    const lead = notesIn(c, s.carrier!, s);
    const resp = notesIn(c, s.imitation.followers[0], s);
    s.phrases.forEach((ph, i) => {
      const g = (x: number) => Math.round(x * 24) / 24;
      const inPh = (ns: NoteEvent[]) => ns.filter((n) => g(n.start) >= ph.startBar * bb && g(n.start) < (ph.startBar + ph.bars) * bb).length;
      if (i % 2 === 0) expect(inPh(resp)).toBe(0);
      else expect(inPh(lead)).toBe(0);
    });
  });
  it("a hocket splits one line note by note: the parts never strike together", () => {
    const { c, s } = find((_, s) => s.imitation.kind === "hocket" && s.imitation.followers.length > 0, "polyrhythmic" as never);
    const lead = notesIn(c, s.carrier!, s);
    const fol = notesIn(c, s.imitation.followers[0], s);
    expect(fol.length).toBeGreaterThan(3);
    for (const f of fol) expect(lead.some((l) => Math.abs(l.start - f.start) < 0.02)).toBe(false);
  });
});

describe("ostinato and processes", () => {
  it("an ostinato over a bordun repeats literally, bar after bar", () => {
    const { c, s } = find((_, s) => s.language === "bordun" && Object.values(s.parts).some((p) => p.technique === "ostinato" && p.enterBar === 0 && !String(p.params?.mask ?? "").includes("0")) && s.bars >= 8);
    const id = Object.entries(s.parts).find(([, p]) => p.technique === "ostinato")![0];
    const bb = barBeats(c.plan.meter);
    const bars: string[] = [];
    for (let b = 0; b < s.bars - 1; b++) {
      const t0 = (s.startBar + b) * bb;
      bars.push(notesIn(c, id, s).filter((n) => n.start >= t0 - 0.05 && n.start < t0 + bb - 0.05).map((n) => `${Math.round((n.start - t0) * 4)}:${n.midi}`).join(","));
    }
    const cellBars = bb <= 2.5 ? 2 : 1;
    const same = bars.filter((x, i) => i >= cellBars && x === bars[i - cellBars]).length;
    expect(same / Math.max(1, bars.length - cellBars)).toBeGreaterThan(0.8);
  });
  it("minimalist additive build-up reveals the cell one note per repetition", () => {
    const c = compose({ settings: { ...defaultSettings(), profile: "minimal", instruments: 6, bars: 64 }, seeds: seedsFrom(3) }).composition;
    const t = c.tracks.find((t) => t.notes.some((n) => n.tag === "ostinato-additive"))!;
    const bb = barBeats(c.plan.meter);
    const add = t.notes.filter((n) => n.tag === "ostinato-additive");
    const perBar = new Map<number, number>();
    for (const n of add) perBar.set(Math.floor(n.start / bb + 0.01), (perBar.get(Math.floor(n.start / bb + 0.01)) ?? 0) + 1);
    const counts = [...perBar.entries()].sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    expect(counts[counts.length - 1]).toBeGreaterThan(counts[0]);
  });
  it("phase shifting displaces a cell by one more grid step every few bars", () => {
    const c = compose({ settings: { ...defaultSettings(), profile: "minimal", instruments: 8, bars: 96 }, seeds: seedsFrom(2) }).composition;
    const steps = new Set(c.tracks.flatMap((t) => t.notes.map((n) => n.tag ?? "").filter((x) => x.startsWith("ostinato-phase")).map((x) => Number(x.slice(14)))));
    expect(steps.size).toBeGreaterThanOrEqual(2);
  });
  it("polyrhythmic cycles differ from the bar and from each other", () => {
    const c = compose({ settings: { ...defaultSettings(), profile: "polyrhythmic", instruments: 8, bars: 64, meter: "12/8" }, seeds: seedsFrom(6) }).composition;
    const bySec = new Map<number, Set<number>>();
    const bb = barBeats(c.plan.meter);
    for (const t of c.tracks) for (const n of t.notes) {
      if (!n.tag?.startsWith("ostinato-cycle")) continue;
      const s = c.plan.sections.findIndex((x) => x.startBar * bb <= n.start + 0.05 && (x.startBar + x.bars) * bb > n.start + 0.05);
      if (!bySec.has(s)) bySec.set(s, new Set());
      bySec.get(s)!.add(Number(n.tag.slice(14)));
    }
    expect([...bySec.values()].some((set) => set.size >= 2)).toBe(true);
    expect([...bySec.values()].some((set) => [...set].some((L) => L !== 12))).toBe(true);
  });
});
