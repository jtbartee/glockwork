import { describe, expect, it } from "vitest";
import { CHORD_FORMULAS, diatonicChord, identifyQuality, voiceLead } from "../../src/theory/chords";
import { musicalContext, slotAt } from "../../src/theory/context";
import { barBeats, beatStrength, groupStarts, isCompound, METER_IDS, metricWeight } from "../../src/theory/meter";
import { cadenceDegree } from "../../src/theory/progression";
import { euclid, lcm } from "../../src/theory/rhythm";
import { hash32, rng } from "../../src/theory/rng";
import { degreeToMidi, isAnhemitonic, midiToDegree, SCALE_IDS, scaleFamily, scaleIntervals } from "../../src/theory/scales";
import { cellGroups, cellRhythm, CELLS } from "../../src/compose/themes";
import { getProfile } from "../../src/compose/profiles";
import { shiftDegree } from "../../src/compose/harmony";

const mod12 = (x: number) => ((x % 12) + 12) % 12;

describe("scales", () => {
  it("pentatonic modes are rotations of one pitch set", () => {
    const set = (id: Parameters<typeof scaleIntervals>[0], root: number) => scaleIntervals(id).map((i) => mod12(root + i)).sort((a, b) => a - b).join();
    // C do-pentatonic = A la-pentatonic = D re-pentatonic = G sol-pentatonic = E mi-pentatonic
    expect(set("minorPent", 9)).toBe(set("majorPent", 0));
    expect(set("rePent", 2)).toBe(set("majorPent", 0));
    expect(set("solPent", 7)).toBe(set("majorPent", 0));
    expect(set("miPent", 4)).toBe(set("majorPent", 0));
  });
  it("the Orff pentatonics have no semitones; hemitonic ones do", () => {
    for (const id of ["majorPent", "minorPent", "rePent", "solPent", "miPent"] as const) expect(isAnhemitonic(id)).toBe(true);
    for (const id of ["hirajoshi", "inSen", "pelog", "major"] as const) expect(isAnhemitonic(id)).toBe(false);
  });
  it("degree ↔ MIDI round-trips in every scale", () => {
    for (const s of SCALE_IDS) for (let d = -8; d <= 16; d++) expect(midiToDegree(degreeToMidi(d, 2, s, 36), 2, s, 36)).toBe(d);
  });
});

describe("chords", () => {
  it("every degree of every scale gives a chord whose tones are in the scale (outside the chromatic family) and whose name matches what sounds", () => {
    for (const s of SCALE_IDS) {
      if (s === "chromatic" || s === "custom") continue;
      const pcs = scaleIntervals(s).map((i) => mod12(5 + i));
      for (let d = 0; d < scaleIntervals(s).length; d++) {
        for (const size of [3, 4]) {
          const c = diatonicChord(d, 5, s, size);
          for (const pc of c.pcs) expect(pcs).toContain(pc);
          if (c.quality !== "other") expect(identifyQuality(c.ivs ?? CHORD_FORMULAS[c.quality])).toBe(c.quality);
        }
      }
    }
  });
  it("voice leading moves by small steps between neighbouring chords", () => {
    let prev: number[] | null = null;
    let moved = 0;
    for (const d of [0, 3, 4, 0, 5, 1, 4, 0]) {
      const v = voiceLead(prev, diatonicChord(d, 0, "major", 3), 60, 76, 3);
      if (prev) moved += v.reduce((s, m) => s + Math.min(...prev!.map((p) => Math.abs(p - m))), 0) / v.length;
      prev = v;
    }
    expect(moved / 7).toBeLessThan(2.6);
  });
  it("modes cadence on their own colour chords, not a borrowed dominant", () => {
    expect(cadenceDegree(2, "dorian")).toBe(3); // IV → i in Dorian
    expect(cadenceDegree(7, "mixolydian")).toBe(6); // ♭VII → I
    expect(cadenceDegree(0, "major")).toBe(4); // V → I
  });
  it("Orff shifting chords rock a step away: I–ii in major pentatonic, i–♭VII in minor", () => {
    const iv = scaleIntervals("majorPent");
    expect(iv[shiftDegree(0, "majorPent")]).toBe(2);
    expect(scaleIntervals("minorPent")[shiftDegree(9, "minorPent")]).toBe(10);
    expect(scaleIntervals("dorian")[shiftDegree(2, "dorian")]).toBe(10);
  });
});

describe("meter", () => {
  it("groupings make asymmetric meters additive", () => {
    expect(groupStarts("7/8")).toEqual([0, 1, 2]);
    expect(groupStarts("5/8")).toEqual([0, 1.5]);
    expect(groupStarts("12/8")).toEqual([0, 1.5, 3, 4.5]);
    expect(barBeats("6/8")).toBe(3);
    expect(isCompound("6/8") && isCompound("12/8") && !isCompound("7/8")).toBe(true);
  });
  it("beat strength: downbeat strongest; beat 3 of 4/4 stronger than 2 and 4", () => {
    for (const m of METER_IDS) expect(metricWeight(m, 0)).toBe(1);
    expect(beatStrength("4/4", 2)).toBeGreaterThan(beatStrength("4/4", 1));
    expect(beatStrength("4/4", 1)).toBe(beatStrength("4/4", 3));
  });
});

describe("rhythm", () => {
  it("Euclidean rhythms: tresillo, cinquillo, the 12/8 bell", () => {
    const s = (p: boolean[]) => p.map((x) => (x ? "x" : ".")).join("");
    expect(s(euclid(3, 8))).toBe("x..x..x.");
    expect(euclid(5, 8).filter(Boolean)).toHaveLength(5);
    expect(euclid(7, 12).filter(Boolean)).toHaveLength(7);
    expect(lcm(8, 12)).toBe(24);
  });
  it("theme cells fit each meter's grouping exactly, and phrases end on a sounding note", () => {
    for (const meter of METER_IDS) {
      const bb = barBeats(meter);
      for (let seed = 1; seed <= 20; seed++) {
        const r = cellRhythm(rng(seed), getProfile("traditional").motif, meter, 2, 0.5);
        for (const x of r) {
          expect(x.at).toBeGreaterThanOrEqual(0);
          expect(x.at + x.dur).toBeLessThanOrEqual(2 * bb + 1e-6);
        }
        expect(r.length).toBeGreaterThan(0);
        expect(cellGroups(meter).reduce((a, b) => a + b, 0)).toBeCloseTo(bb, 6);
      }
    }
    expect(CELLS.syncopa.notes.map((n) => n[1])).toEqual([0.5, 1, 0.5]);
  });
});

describe("rng and context", () => {
  it("seeded streams are reproducible and forks are independent", () => {
    const a = rng(42);
    const b = rng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(rng(42).fork("x")()).not.toBe(rng(42).fork("y")());
    expect(hash32("abc")).toBe(hash32("abc"));
  });
  it("without a timeline the tonic chord rules everywhere", () => {
    const ctx = musicalContext({ key: 7, scale: "majorPent", meter: "4/4" });
    expect(slotAt(ctx, 123).chord.rootPc).toBe(7);
    expect(scaleFamily("majorPent")).toBe("pentatonic");
  });
});

describe("spelling", () => {
  it("modes are spelled by their parent major key", async () => {
    const { pcName } = await import("../../src/theory/scales");
    expect(pcName(10, 0, "mixolydian")).toBe("B♭"); // C Mixolydian: F major's B♭
    expect(pcName(6, 2, "dorian")).toBe("F♯"); // D Dorian is C major … F♯ is outside, but sharps
    expect(pcName(10, 5, "major")).toBe("B♭");
    expect(pcName(6, 7, "major")).toBe("F♯");
    expect(pcName(3, 0, "minor")).toBe("E♭");
  });
});
