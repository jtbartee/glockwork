// ORCHESTRATION. Before any note is written the composer decides, section by section, who plays:
// how many parts the section's intensity and the arrangement-density control call for, which ones
// (foundation first, as an Orff ensemble builds — bordun, then ostinato, then melody, then colour),
// when newcomers enter (one per phrase in a build-up), who leaves before the end, who carries the
// principal line (contrast sections may hand it to an instrument of another family), and which
// imitation device — echo, call-and-response, canon, hocket, parallel, heterophony — joins the
// carrier with which follower. Returning sections reuse the orchestration of their first statement
// so a refrain sounds like itself. Non-essential parts rest for whole phrases: silence is planned.

import type { Rng } from "../theory/rng";
import { ensembleInfo, instrumentRange } from "./instruments";
import { entries, imitationWeights, type Profile } from "./profiles";
import type { ComposeControls, FormId, ImitationKind, PartPlan, RoleId, Section, Track } from "./types";

const ENTRY_ORDER: RoleId[] = ["bordun", "bass", "ostinato", "melody", "harmony", "counter", "secondary", "arpeggio", "texture", "punctuation", "experimental"];
const FOUNDATION: RoleId[] = ["bordun", "bass"];

export function entryRank(role: RoleId): number {
  const k = ENTRY_ORDER.indexOf(role);
  return k < 0 ? ENTRY_ORDER.length : k;
}

/** The track that should carry the principal line when none has the melody role. */
export function melodyCarrier(tracks: Track[]): Track | null {
  const m = tracks.find((t) => t.role === "melody");
  if (m) return m;
  const ranked = [...tracks].sort((a, b) => (ensembleInfo(b.instrumentId).fitness.melody ?? 0) - (ensembleInfo(a.instrumentId).fitness.melody ?? 0));
  return ranked[0] ?? null;
}

function overlap(a: [number, number], b: [number, number]): number {
  return Math.min(a[1], b[1]) - Math.max(a[0], b[0]);
}

/** Octave transposition that brings a follower's range onto the carrier's. */
function octaveBetween(carrier: [number, number], follower: [number, number]): number {
  const cc = (carrier[0] + carrier[1]) / 2;
  const cf = (follower[0] + follower[1]) / 2;
  return Math.round((cf - cc) / 12) * 12;
}

export interface OrchestrationInput {
  sections: Section[];
  tracks: Track[];
  profile: Profile;
  controls: ComposeControls;
  form: FormId;
  realism: "orff" | "extended";
  themeBars: number;
  phraseBars: number;
}

/** Continuity between calls (the endless performer orchestrates a chapter at a time). */
export interface OrchestrationState {
  prevActive: Set<string>;
  byLetter: Map<string, { active: Set<string>; carrier: string | null }>;
  /** freeze the active set (instruments lock in an endless performance) */
  frozen?: boolean;
}

export function newOrchestrationState(): OrchestrationState {
  return { prevActive: new Set(), byLetter: new Map() };
}

export function orchestrate(o: OrchestrationInput, r: Rng, state: OrchestrationState = newOrchestrationState()): void {
  const { sections, tracks, profile, controls } = o;
  const N = tracks.length;
  const main = melodyCarrier(tracks);
  const byLetter = state.byLetter;
  let prevActive = state.prevActive;
  const foundation = tracks.filter((t) => FOUNDATION.includes(t.role));
  const ostinatos = tracks.filter((t) => t.role === "ostinato");
  const processDriven = profile.process !== "none";

  // who is chosen first is the profile's own priority (ambient: texture and harmony are core);
  // the order newcomers enter in a build-up stays elemental (foundation, ostinato, melody, colour)
  // a second texture ranks where "texture" appears a second time in the profile's list
  const nth = new Map<string, number>();
  const seenRole: Record<string, number> = {};
  for (const t of tracks) {
    const k = seenRole[t.role] ?? 0;
    seenRole[t.role] = k + 1;
    nth.set(t.id, k);
  }
  const pick = (t: Track) => {
    let idx = -1;
    for (let i = 0, seen = 0; i < profile.roles.length; i++) {
      if (profile.roles[i] !== t.role) continue;
      if (seen++ === (nth.get(t.id) ?? 0)) {
        idx = i;
        break;
      }
    }
    return idx < 0 ? profile.roles.length + (nth.get(t.id) ?? 0) : idx;
  };
  sections.forEach((sec, si) => {
    const rr = r.fork(`orch:${sec.index}`);
    // ---- carrier
    let carrier: Track | null = sec.theme ? main : null;
    const prior = sec.theme ? byLetter.get(sec.theme) : undefined;
    if (prior) carrier = tracks.find((t) => t.id === prior.carrier) ?? carrier;
    else if (sec.fn === "contrast" && main && !processDriven && rr.chance(0.55)) {
      const alt = tracks
        .filter((t) => t.id !== main.id && (t.role === "secondary" || t.role === "counter" || t.role === "harmony") && (ensembleInfo(t.instrumentId).fitness.melody ?? 0) >= 0.45)
        .sort((a, b) => Number(ensembleInfo(b.instrumentId).family !== ensembleInfo(main.instrumentId).family) - Number(ensembleInfo(a.instrumentId).family !== ensembleInfo(main.instrumentId).family));
      if (alt[0]) carrier = alt[0];
    }
    // minimal and polyrhythmic pieces hold their melody back until the texture is established
    if (carrier && processDriven && sec.fn !== "climax" && sec.intensity < 0.55 && rr.chance(0.6)) carrier = null;
    if (sec.fn === "intro") carrier = null;

    // ---- active set
    const essential = new Set<string>();
    for (const t of foundation.slice(0, 2)) essential.add(t.id);
    if (carrier) essential.add(carrier.id);
    if (processDriven || sec.fn !== "intro") for (const t of ostinatos.slice(0, processDriven ? 2 : 1)) essential.add(t.id);
    if (!essential.size && tracks[0]) essential.add(tracks[0].id);
    let frac = 0.28 + 0.72 * Math.pow(sec.intensity, 0.85);
    frac *= 0.55 + 0.9 * controls.arrangementDensity;
    if (sec.fn === "intro") frac = Math.min(frac, 0.45);
    if (sec.fn === "ending") frac = Math.min(frac, 0.5);
    let k = Math.max(essential.size, Math.min(N, Math.round(N * Math.min(1, frac))));
    if (sec.fn === "climax" && controls.arrangementDensity >= 0.3) k = N;
    const active = new Set<string>(prior ? [...prior.active].filter((id) => tracks.some((t) => t.id === id)) : []);
    for (const id of essential) active.add(id);
    if (prior && sec.variant > 0 && active.size < k) k = Math.max(k, active.size + 1);
    const contrast = sec.fn === "contrast";
    const carrierFamily = carrier ? ensembleInfo(carrier.instrumentId).family : null;
    const cand = tracks
      .filter((t) => !active.has(t.id))
      .map((t) => {
        let s = -pick(t) * 0.12 + rr() * 0.25;
        if (contrast) s += (prevActive.has(t.id) ? 0 : 0.4) + (carrierFamily && ensembleInfo(t.instrumentId).family !== carrierFamily ? 0.25 : 0);
        if (sec.fn === "ending" && (t.role === "texture" || t.role === "harmony")) s += 0.3;
        return { t, s };
      })
      .sort((a, b) => b.s - a.s);
    for (const { t } of cand) {
      if (active.size >= k) break;
      active.add(t.id);
    }
    // a contrast also takes something away: one part of the previous texture rests
    if (state.frozen && prevActive.size) {
      active.clear();
      for (const id of prevActive) active.add(id);
      for (const id of essential) active.add(id);
    }
    if (contrast && !state.frozen && active.size > essential.size + 1) {
      const drop = [...active].find((id) => prevActive.has(id) && !essential.has(id));
      if (drop) active.delete(drop);
    }
    if (sec.theme && !prior) byLetter.set(sec.theme, { active: new Set(active), carrier: carrier?.id ?? null });

    // ---- entrances and exits (bars relative to the section)
    const phrases = sec.phrases;
    const phraseStarts = phrases.map((p) => p.startBar - sec.startBar);
    const newcomers = tracks.filter((t) => active.has(t.id) && !prevActive.has(t.id)).sort((a, b) => entryRank(a.role) - entryRank(b.role));
    const build = phrases.length >= 2 && (sec.fn === "intro" || sec.index === 0 || (sec.fn === "climax" && newcomers.length >= 3) || (processDriven && sec.fn === "development"));
    const enter = new Map<string, number>();
    if (build) {
      let slot = 0;
      newcomers.forEach((t, idx) => {
        if (essential.has(t.id) && (FOUNDATION.includes(t.role) || idx === 0)) return enter.set(t.id, 0);
        if (t.id === carrier?.id && sec.fn !== "intro") return enter.set(t.id, sec.index === 0 && phrases.length >= 3 ? phraseStarts[1] : 0);
        slot = Math.min(phrases.length - 1, slot + 1);
        enter.set(t.id, phraseStarts[slot]);
      });
    }
    const exit = new Map<string, number>();
    if (sec.fn === "ending" && phrases.length >= 2) {
      const leaving = tracks.filter((t) => active.has(t.id) && !essential.has(t.id) && t.role !== "texture").sort((a, b) => entryRank(b.role) - entryRank(a.role));
      leaving.forEach((t, idx) => exit.set(t.id, phraseStarts[Math.max(1, phrases.length - 1 - idx)] ?? sec.bars));
    }

    // ---- imitation
    let kind: ImitationKind = "none";
    let followers: string[] = [];
    let offsetBars = Math.max(1, o.themeBars);
    let interval = 0;
    if (carrier && sec.fn !== "intro") {
      const w = imitationWeights(profile, sec.fn);
      const { items, weights } = entries(w);
      const ww = items.map((it, i) => weights[i] * (it === "none" ? 1.4 - controls.counterpoint : 0.4 + controls.counterpoint));
      kind = items.length ? rr.weighted(items, ww) : "none";
      if (o.form === "canon" && sec.theme) kind = sec.variant === 0 ? "none" : "canon";
      const cRange = instrumentRange(carrier.instrumentId, o.realism);
      const pool = tracks
        .filter((t) => t.id !== carrier!.id && active.has(t.id) && !essential.has(t.id) && !FOUNDATION.includes(t.role) && t.role !== "punctuation")
        .map((t) => {
          const info = ensembleInfo(t.instrumentId);
          const fRange = instrumentRange(t.instrumentId, o.realism);
          const melodic = Math.max(info.fitness.melody ?? 0, info.fitness.secondary ?? 0);
          const ov = overlap(cRange, fRange.map((x) => x - octaveBetween(cRange, fRange)) as [number, number]);
          const roleBonus = t.role === "secondary" ? 0.5 : t.role === "counter" ? 0.25 : t.role === "texture" && kind === "echo" ? 0.3 : 0;
          return { t, s: melodic + roleBonus + rr() * 0.1, ov, fRange };
        })
        .filter((x) => x.s >= 0.45 && x.ov >= 9)
        .sort((a, b) => b.s - a.s);
      const voices = o.form === "canon" && kind === "canon" ? Math.min(pool.length, Math.max(1, sec.index - Math.max(0, firstThemeIndex(sections)))) : 1;
      if (kind !== "none" && pool.length) {
        const chosen = pool.slice(0, Math.max(1, voices));
        followers = chosen.map((x) => x.t.id);
        interval = octaveBetween(cRange, chosen[0].fRange);
        for (const f of followers) active.add(f);
        if (kind === "canon") offsetBars = o.form === "canon" ? Math.max(1, Math.round(o.phraseBars / 2)) : Math.max(1, o.themeBars);
        if (kind === "echo") offsetBars = Math.max(1, Math.min(2, o.themeBars));
        if (kind === "call") offsetBars = o.phraseBars;
      } else kind = "none";
    }

    // ---- part plans
    const parts: Record<string, PartPlan> = {};
    for (const t of tracks) {
      if (!active.has(t.id)) {
        parts[t.id] = { technique: null, enterBar: 0, exitBar: sec.bars };
        continue;
      }
      let technique: string = t.role;
      if (followers.includes(t.id)) technique = `imitate:${kind}`;
      else if (t.id === carrier?.id) technique = "melody";
      else if (t.role === "melody") technique = carrier ? "counter" : sec.fn === "intro" ? "" : "melody";
      else if (t.role === "secondary") technique = carrier ? (controls.counterpoint > 0.5 ? "counter" : "parallel") : "";
      if (technique === "") {
        parts[t.id] = { technique: null, enterBar: 0, exitBar: sec.bars };
        continue;
      }
      // whole phrases of rest for parts that are colour rather than structure
      const mask = phrases.map(() => "1");
      const restable = !essential.has(t.id) && !followers.includes(t.id) && !["texture", "punctuation"].includes(t.role);
      if (restable && phrases.length >= 2) {
        const p = profile.silence * (1.15 - sec.intensity * 0.6);
        let dropped = 0;
        for (let i = 0; i < phrases.length; i++) {
          if (dropped < phrases.length - 1 && rr.chance(p) && mask[i - 1] !== "0") {
            mask[i] = "0";
            dropped++;
          }
        }
      }
      parts[t.id] = { technique, enterBar: enter.get(t.id) ?? 0, exitBar: exit.get(t.id) ?? sec.bars, params: { mask: mask.join("") } };
    }

    sec.carrier = carrier?.id ?? null;
    sec.imitation = { kind, followers, offsetBars, interval };
    sec.parts = parts;
    prevActive = new Set([...active].filter((id) => parts[id]?.technique));
    state.prevActive = prevActive;
  });
}

function firstThemeIndex(sections: Section[]): number {
  return sections.findIndex((s) => s.theme);
}
