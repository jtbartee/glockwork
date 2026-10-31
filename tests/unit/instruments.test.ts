import { describe, expect, it } from "vitest";
import { INSTRUMENTS } from "../../src/audio/instruments";
import { ENSEMBLE_INSTRUMENTS, ensembleInfo, instrumentRange, partRange } from "../../src/compose/instruments";
import { getProfile, PROFILE_IDS } from "../../src/compose/profiles";
import { assignRoles, autoLineup, hungarian, ROLE_IDS } from "../../src/compose/roles";

describe("ensemble instruments", () => {
  it("every synthesis model has ensemble knowledge", () => {
    for (const i of INSTRUMENTS) expect(ENSEMBLE_INSTRUMENTS[i.id], i.id).toBeDefined();
  });
  it("playable Orff/concert ranges sit inside the extended electronic ranges", () => {
    for (const e of Object.values(ENSEMBLE_INSTRUMENTS)) {
      expect(e.orffRange[0]).toBeGreaterThanOrEqual(e.extRange[0]);
      expect(e.orffRange[1]).toBeLessThanOrEqual(e.extRange[1]);
      expect(e.orffRange[1] - e.orffRange[0]).toBeGreaterThanOrEqual(17); // tubular bells: C4–F5
    }
  });
  it("Orff barred instruments span C–A over an octave and a sixth, at their sounding octaves", () => {
    expect(instrumentRange("orff-soprano-glock", "orff")).toEqual([84, 105]);
    expect(instrumentRange("orff-alto-xylo", "orff")).toEqual([60, 81]);
    expect(instrumentRange("orff-bass-metal", "orff")).toEqual([48, 69]);
    expect(ensembleInfo("orff-alto-xylo").mallets).toBe(2);
    expect(ensembleInfo("marimba").mallets).toBe(4);
  });
  it("a role narrows a range only when room is left for music", () => {
    for (const e of Object.values(ENSEMBLE_INSTRUMENTS)) for (const role of ROLE_IDS) {
      const [lo, hi] = partRange(e.id, role, "orff");
      expect(hi - lo).toBeGreaterThanOrEqual(14);
      expect(lo).toBeGreaterThanOrEqual(e.orffRange[0]);
      expect(hi).toBeLessThanOrEqual(e.orffRange[1]);
    }
  });
});

describe("role assignment", () => {
  it("the Hungarian solver finds the optimal assignment", () => {
    const cost = [[4, 1, 3], [2, 0, 5], [3, 2, 2]];
    const a = hungarian(cost);
    const total = a.reduce((s, j, i) => s + cost[i][j], 0);
    expect(total).toBe(5);
  });
  it("a classroom lineup gets bordun/bass on bass bars, melody on soprano xylophone, colour on glockenspiel", () => {
    const p = getProfile("traditional");
    const ids = autoLineup(p, 8);
    const roles = assignRoles(ids, p);
    const roleOf = (id: string) => roles[ids.indexOf(id)];
    expect(roleOf("orff-soprano-xylo")).toBe("melody");
    expect(["bordun", "bass"]).toContain(roleOf("orff-bass-xylo"));
    expect(["bordun", "bass"]).toContain(roleOf("orff-bass-metal"));
    expect(roleOf("orff-soprano-glock")).toBe("texture");
  });
  it("roles follow the instruments present, not a fixed list", () => {
    const p = getProfile("traditional");
    const glocks = assignRoles(["orff-soprano-glock", "orff-alto-glock", "orchestral-bells", "crotales"], p);
    expect(glocks).not.toContain("bass");
    expect(glocks).not.toContain("bordun");
    const lows = assignRoles(["orff-bass-xylo", "orff-bass-metal", "marimba", "orff-alto-xylo"], p);
    expect(lows.filter((r) => r === "bordun" || r === "bass").length).toBeGreaterThanOrEqual(2);
  });
  it("pinned roles are kept", () => {
    const p = getProfile("cinematic");
    const roles = assignRoles(["marimba", "vibraphone", "orff-bass-xylo"], p, [null, "texture", null]);
    expect(roles[1]).toBe("texture");
  });
  it("every profile can field 12 parts", () => {
    for (const id of PROFILE_IDS) {
      const p = getProfile(id);
      const roles = assignRoles(autoLineup(p, 12), p);
      expect(roles).toHaveLength(12);
      expect(new Set(roles).size).toBeGreaterThanOrEqual(5);
    }
  });
});
