import { describe, expect, it } from "vitest";
import { compose, defaultSettings, NO_LOCKS, reseed, seedsFrom } from "../../src/compose/composer";
import { EndlessComposer } from "../../src/compose/endless";
import type { Composition, Locks } from "../../src/compose/types";
import { barBeats } from "../../src/theory/meter";

const settings = { ...defaultSettings(), profile: "cinematic" as const, instruments: 8, bars: 48, key: 2 as const, scale: "dorian" as const, meter: "4/4" as const, bpm: 96 };
const first = compose({ settings, seeds: seedsFrom(10) }).composition;

function regen(locks: Partial<Locks>, prev: Composition = first, master = 77): Composition {
  const l = { ...NO_LOCKS, ...locks };
  return compose({ settings: prev.settings, seeds: reseed(prev.seeds, master, l), locks: l, previous: prev }).composition;
}

const pitches = (c: Composition) => c.tracks.map((t) => t.notes.map((n) => n.midi).join(",")).join("|");
const onsets = (c: Composition, id: string) => c.tracks.find((t) => t.id === id)!.notes.map((n) => n.start.toFixed(4));

describe("locks", () => {
  it("regenerating with nothing locked changes the music", () => {
    expect(pitches(regen({}))).not.toBe(pitches(first));
  });
  it("harmony lock keeps the chord timeline while melodies change", () => {
    const c = regen({ harmony: true });
    expect(JSON.stringify(c.plan.harmony)).toBe(JSON.stringify(first.plan.harmony));
    expect(pitches(c)).not.toBe(pitches(first));
  });
  it("melody lock keeps the carrier lines note for note", () => {
    const c = regen({ melody: true, arrangement: true, instruments: true });
    for (const sec of first.plan.sections) {
      if (!sec.carrier) continue;
      const bb = barBeats(first.plan.meter);
      const span = (x: Composition) => x.tracks.find((t) => t.id === sec.carrier)!.notes.filter((n) => n.start >= sec.startBar * bb && n.start < (sec.startBar + sec.bars) * bb).map((n) => n.midi);
      expect(span(c)).toEqual(span(first));
    }
  });
  it("rhythm lock keeps every part's onsets while pitches follow new harmony", () => {
    const c = regen({ rhythm: true, instruments: true, arrangement: true });
    let differentPitch = false;
    for (const t of first.tracks) {
      const a = onsets(first, t.id);
      const b = onsets(c, t.id);
      if (a.length && b.length) {
        const common = b.filter((x) => a.includes(x)).length;
        expect(common / a.length).toBeGreaterThan(0.85);
      }
      if (c.tracks.find((x) => x.id === t.id)!.notes.map((n) => n.midi).join() !== t.notes.map((n) => n.midi).join()) differentPitch = true;
    }
    expect(differentPitch).toBe(true);
  });
  it("arrangement lock keeps form, sections and orchestration", () => {
    const c = regen({ arrangement: true, instruments: true });
    expect(JSON.stringify(c.plan.sections.map((s) => [s.label, s.fn, s.bars, s.carrier, Object.values(s.parts).map((p) => p.technique)]))).toBe(JSON.stringify(first.plan.sections.map((s) => [s.label, s.fn, s.bars, s.carrier, Object.values(s.parts).map((p) => p.technique)])));
  });
  it("instruments lock keeps lineup, roles and sound design", () => {
    const edited = structuredClone(first);
    edited.tracks[2].engine.bar.decay = 0.91;
    const c = regen({ instruments: true }, edited);
    expect(c.tracks.map((t) => [t.instrumentId, t.role])).toEqual(edited.tracks.map((t) => [t.instrumentId, t.role]));
    expect(c.tracks[2].engine.bar.decay).toBe(0.91);
  });
  it("a locked track keeps its notes verbatim, including user edits", () => {
    const edited = structuredClone(first);
    edited.tracks[1].locked = true;
    edited.tracks[1].notes[0].midi += 2;
    const c = regen({ instruments: true }, edited);
    expect(c.tracks[1].notes).toEqual(edited.tracks[1].notes);
  });
  it("a key change carries locked material into the new key", () => {
    const edited = structuredClone(first);
    edited.tracks[0].locked = true;
    const moved = compose({ settings: { ...settings, key: 4 }, seeds: edited.seeds, locks: { ...NO_LOCKS, instruments: true }, previous: edited });
    expect(moved.composition.tracks[0].notes.map((n) => n.midi)).toEqual(edited.tracks[0].notes.map((n) => n.midi + 2));
    expect(moved.notices.length).toBeGreaterThan(0);
  });
});

describe("endless performance", () => {
  const es = { ...defaultSettings(), profile: "traditional" as const, instruments: 6, mode: "endless" as const };
  it("is reproducible from its seed, however it is generated", () => {
    const a = new EndlessComposer(es, seedsFrom(4), NO_LOCKS);
    a.ensure(200);
    const b = new EndlessComposer(es, seedsFrom(4), NO_LOCKS);
    b.ensure(40);
    b.ensure(120);
    b.ensure(200);
    const cut = (x: EndlessComposer) => x.composition.tracks.map((t) => t.notes.filter((n) => n.start < 150 * 4).map((n) => `${n.start}:${n.midi}`).join(","));
    expect(cut(b)).toEqual(cut(a));
  });
  it("keeps evolving: new themes, entries and exits, a moving intensity", () => {
    const e = new EndlessComposer({ ...es, controls: { ...es.controls, evolution: 0.8 } }, seedsFrom(9), NO_LOCKS);
    e.ensure(400);
    expect(Object.keys(e.plan.themes).length).toBeGreaterThanOrEqual(2);
    const ints = e.plan.sections.map((s) => s.intensity);
    expect(Math.max(...ints) - Math.min(...ints)).toBeGreaterThan(0.3);
    const textures = new Set(e.plan.sections.map((s) => Object.entries(s.parts).filter(([, p]) => p.technique).map(([id]) => id).join()));
    expect(textures.size).toBeGreaterThan(3);
  });
  it("trimming bounds memory and capture gives an editable arrangement", () => {
    const e = new EndlessComposer(es, seedsFrom(2), NO_LOCKS);
    e.ensure(160);
    const before = e.composition.tracks.reduce((s, t) => s + t.notes.length, 0);
    const cap = e.capture(32, 96);
    expect(cap.plan.bars).toBe(64);
    expect(cap.settings.mode).toBe("arrangement");
    expect(cap.tracks.every((t) => t.notes.every((n) => n.start >= 0 && n.start < 64 * barBeats(cap.plan.meter)))).toBe(true);
    e.trim(120);
    const after = e.composition.tracks.reduce((s, t) => s + t.notes.length, 0);
    expect(after).toBeLessThan(before * 0.5);
    e.ensure(300);
    expect(e.plan.bars).toBeGreaterThanOrEqual(300);
  });
  it("melody lock stops new themes; a locked track repeats its last section", () => {
    const e = new EndlessComposer(es, seedsFrom(9), { ...NO_LOCKS, melody: true });
    e.ensure(300);
    expect(Object.keys(e.plan.themes)).toEqual(["A"]);
  });
});
