// LINEUP AND ROLES. An automatic lineup draws instruments in the profile's order; roles are then
// assigned by an optimal matching between the instruments present and the profile's priority list
// of roles (Hungarian algorithm), weighting each instrument's fitness for a role by how essential
// the role is. With four glockenspiels the result differs from a classroom Orff set; roles no
// instrument suits are simply left out rather than forced.

import { getInstrument } from "../audio/instruments";
import type { EngineParams } from "../audio/types";
import { clamp } from "../utils/math";
import { ensembleInfo, ENSEMBLE_INSTRUMENTS } from "./instruments";
import type { Profile } from "./profiles";
import type { RoleId, Track } from "./types";
import type { Rng } from "../theory/rng";

export const ROLE_LABELS: Record<RoleId, string> = {
  bass: "Bass foundation",
  bordun: "Bordun",
  ostinato: "Ostinato",
  melody: "Primary melody",
  secondary: "Secondary melody",
  counter: "Counter-melody",
  harmony: "Harmony",
  arpeggio: "Arpeggiation",
  punctuation: "Rhythmic punctuation",
  texture: "Atmospheric texture",
  experimental: "Experimental voice",
};

export const ROLE_IDS = Object.keys(ROLE_LABELS) as RoleId[];

export const TRACK_COLORS = ["#3f9088", "#d9722c", "#d9ab3c", "#8163a8", "#c85a4a", "#5a8f4e", "#c27c9a", "#4f7fb0", "#a8763e", "#6aa6a0", "#b0a040", "#9a5a8a", "#5b9ad0", "#d08b5b", "#7a9a3a", "#c05a6a"];

/** Instruments for an automatic lineup of `count` parts. */
export function autoLineup(profile: Profile, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(profile.lineup[i % profile.lineup.length]);
  return out;
}

/** Hungarian algorithm (shortest augmenting path with potentials) for an n×m cost matrix, n ≤ m.
 *  Returns, for each row, the column assigned to it. */
export function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const m = cost[0]?.length ?? 0;
  const INF = 1e18;
  const u = new Array(n + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0);
  const way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(m + 1).fill(INF);
    const used = new Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const out = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j] > 0) out[p[j] - 1] = j - 1;
  return out;
}

/** Assign a role to every instrument. Pinned roles are kept; the rest are matched optimally. */
export function assignRoles(instrumentIds: string[], profile: Profile, pinned: (RoleId | null)[] = []): RoleId[] {
  const n = instrumentIds.length;
  const roles: (RoleId | null)[] = instrumentIds.map((_, i) => pinned[i] ?? null);
  const slots: RoleId[] = [...profile.roles];
  // more instruments than the priority list: extra copies of the roles that can take doubling
  while (slots.length < n + 4) slots.push(...(["ostinato", "texture", "secondary", "counter", "harmony"] as RoleId[]));
  for (const r of roles) {
    if (!r) continue;
    const k = slots.indexOf(r);
    if (k >= 0) slots.splice(k, 1);
  }
  const free = instrumentIds.map((id, i) => ({ id, i })).filter((x) => roles[x.i] === null);
  if (free.length) {
    const cols = slots.slice(0, Math.max(free.length, Math.min(slots.length, free.length + 4)));
    const cost = free.map(({ id }) =>
      cols.map((role, k) => {
        const fit = ensembleInfo(id).fitness[role] ?? 0;
        const priority = 1 / (1 + 0.16 * k);
        return fit <= 0.05 ? 10 : -(priority * fit + fit * 0.05);
      }),
    );
    const pick = hungarian(cost);
    free.forEach((x, r) => (roles[x.i] = cols[pick[r]] ?? "ostinato"));
  }
  return roles as RoleId[];
}

const ROLE_GAIN: Record<RoleId, number> = {
  melody: 1, secondary: 0.82, counter: 0.78, bass: 0.95, bordun: 0.85, ostinato: 0.74, harmony: 0.64,
  arpeggio: 0.64, punctuation: 0.72, texture: 0.6, experimental: 0.72,
};

/** Seating: foundations in the centre, the rest fanned out left and right by register. */
function seatPan(role: RoleId, index: number, count: number, register: number): number {
  if (role === "bass" || role === "bordun") return clamp((index % 2 ? -1 : 1) * 0.08, -1, 1);
  const side = index % 2 ? -1 : 1;
  const spread = 0.2 + 0.45 * clamp((register - 48) / 48, 0, 1) + 0.1 * (index / Math.max(1, count));
  return clamp(side * spread, -0.85, 0.85);
}

/** The instrument's factory sound, adjusted for the profile (ambient lets bars ring longer). */
export function profileEngine(instrumentId: string, profile: Profile): EngineParams {
  const e: EngineParams = structuredClone(getInstrument(instrumentId).defaults);
  if (profile.decayScale !== 1) e.bar.decay = clamp(e.bar.decay + Math.log(profile.decayScale) / Math.log(75), 0, 1);
  // the ensemble positions parts in the stereo field; keep each instrument's own image narrow
  e.stereo.voiceSpread = Math.min(e.stereo.voiceSpread, 0.25);
  e.stereo.panRandom = Math.min(e.stereo.panRandom, 0.1);
  return e;
}

export function makeTrack(id: string, instrumentId: string, role: RoleId, index: number, count: number, profile: Profile, seed: number, sameBefore: number): Track {
  const info = ensembleInfo(instrumentId);
  const name = getInstrument(instrumentId).name + (sameBefore > 0 ? ` ${sameBefore + 1}` : "");
  const register = (info.orffRange[0] + info.orffRange[1]) / 2;
  const gain = clamp((ROLE_GAIN[role] * 0.85) / info.level, 0.2, 1.4);
  const reverb = clamp(profile.reverb + (info.family === "metal" ? 0.06 : 0) + (role === "texture" ? 0.12 : 0) + (role === "bass" ? -0.08 : 0), 0, 1);
  return {
    id,
    name,
    instrumentId,
    role,
    pinned: false,
    locked: false,
    engine: profileEngine(instrumentId, profile),
    mix: { gain, pan: seatPan(role, index, count, register), mute: false, solo: false, reverb, delay: role === "texture" && profile.id === "ambient" ? 0.15 : 0 },
    damp: "auto",
    color: TRACK_COLORS[index % TRACK_COLORS.length],
    seed,
    variation: 0,
    notes: [],
  };
}

/** Build the track list for a lineup, keeping existing tracks whose instrument or role was pinned. */
export function buildTracks(profile: Profile, count: number, r: Rng, previous: Track[] = [], keepAll = false): Track[] {
  if (keepAll && previous.length) return previous.map((t) => ({ ...t, notes: t.notes }));
  const n = clamp(Math.round(count), 1, 16);
  const auto = autoLineup(profile, n);
  const ids = auto.map((id, i) => (previous[i]?.pinned ? previous[i].instrumentId : id));
  const pinnedRoles = ids.map((_, i) => (previous[i]?.pinned ? previous[i].role : null));
  const roles = assignRoles(ids, profile, pinnedRoles);
  const seen: Record<string, number> = {};
  return ids.map((instrumentId, i) => {
    const prev = previous[i];
    if (prev?.pinned) return { ...prev, notes: prev.notes };
    const before = seen[instrumentId] ?? 0;
    seen[instrumentId] = before + 1;
    const t = makeTrack(`t${i + 1}`, instrumentId, roles[i], i, n, profile, (r() * 2 ** 31) >>> 0, before);
    // a locked track survives with its notes and sound even if the lineup changes around it
    if (prev?.locked && prev.instrumentId === instrumentId) return { ...prev, notes: prev.notes };
    return t;
  });
}

export const isEnsembleInstrument = (id: string): boolean => Boolean(ENSEMBLE_INSTRUMENTS[id]);
