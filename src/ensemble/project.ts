// PROJECT FILES. A composition is saved whole and loaded back losslessly: settings, seeds, locks,
// the plan (form, sections, phrases, harmony, themes), every track's instrument, role, sound design,
// mix and notes. Loading validates everything — a hand-edited or damaged file falls back field by
// field to safe values rather than breaking the app, and a file that is not a GLOCKWORK ensemble is
// refused with a clear message.

import { getInstrument, INSTRUMENTS } from "../audio/instruments";
import { defaultMaster, defaultSettings, NO_LOCKS, seedsFrom } from "../compose/composer";
import { getProfile, PROFILE_IDS } from "../compose/profiles";
import { ROLE_IDS } from "../compose/roles";
import type { ComposeSettings, Composition, NoteEvent, Plan, Track } from "../compose/types";
import { sanitizeEngine } from "../presets/schema";
import { METER_IDS } from "../theory/meter";
import { SCALE_IDS } from "../theory/scales";

export const PROJECT_FORMAT = "glockwork-ensemble";
export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = ".glockwork.json";

export function serializeProject(c: Composition): string {
  return JSON.stringify({ ...c, format: PROJECT_FORMAT, version: PROJECT_VERSION });
}

const num = (v: unknown, fb: number, lo = -Infinity, hi = Infinity) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb);
const bool = (v: unknown, fb: boolean) => (typeof v === "boolean" ? v : fb);
const oneOf = <T extends string>(v: unknown, opts: readonly T[], fb: T): T => (typeof v === "string" && (opts as readonly string[]).includes(v) ? (v as T) : fb);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function sanitizeSettings(raw: unknown): ComposeSettings {
  const d = defaultSettings();
  const r = obj(raw);
  const c = obj(r.controls);
  const controls = { ...d.controls };
  for (const k of Object.keys(controls) as (keyof typeof controls)[]) controls[k] = num(c[k], d.controls[k], 0, 1);
  return {
    mode: oneOf(r.mode, ["arrangement", "endless"] as const, d.mode),
    profile: oneOf(r.profile, PROFILE_IDS, d.profile),
    key: r.key === "auto" ? "auto" : Math.round(num(r.key, 0, 0, 11)),
    scale: r.scale === "auto" ? "auto" : oneOf(r.scale, SCALE_IDS, "majorPent"),
    meter: r.meter === "auto" ? "auto" : oneOf(r.meter, METER_IDS, "4/4"),
    bpm: r.bpm === "auto" ? "auto" : num(r.bpm, 100, 30, 240),
    form: r.form === "auto" ? "auto" : oneOf(r.form, ["rondo", "aba", "aaba", "arch", "through", "binary", "variations", "process", "canon"] as const, "aba"),
    lengthMode: oneOf(r.lengthMode, ["bars", "duration"] as const, d.lengthMode),
    bars: Math.round(num(r.bars, d.bars, 4, 512)),
    seconds: num(r.seconds, d.seconds, 10, 3600),
    instruments: Math.round(num(r.instruments, d.instruments, 1, 16)),
    realism: oneOf(r.realism, ["orff", "extended"] as const, d.realism),
    controls,
  };
}

function sanitizeNotes(raw: unknown): NoteEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: NoteEvent[] = [];
  const ids = new Set<number>();
  for (const x of raw) {
    const n = obj(x);
    const start = num(n.start, NaN, 0, 1e7);
    const dur = num(n.dur, NaN, 0.001, 1e5);
    const midi = num(n.midi, NaN, 0, 127);
    if (!Number.isFinite(start) || !Number.isFinite(dur) || !Number.isFinite(midi)) continue;
    let id = Math.round(num(n.id, 0, 0, 1e9));
    if (!id || ids.has(id)) id = 0;
    const note: NoteEvent = { id, start, dur, midi: Math.round(midi), vel: num(n.vel, 0.7, 0.01, 1) };
    if (typeof n.motif === "string") note.motif = n.motif;
    if (typeof n.tag === "string") note.tag = n.tag;
    if (id) ids.add(id);
    out.push(note);
  }
  out.sort((a, b) => a.start - b.start || a.midi - b.midi);
  let next = Math.max(0, ...ids) + 1;
  for (const n of out) if (!n.id) n.id = next++;
  return out;
}

function sanitizeTrack(raw: unknown, i: number, profileId: Composition["settings"]["profile"]): Track {
  const r = obj(raw);
  const instrumentId = INSTRUMENTS.some((x) => x.id === r.instrumentId) ? (r.instrumentId as string) : "orff-alto-xylo";
  const m = obj(r.mix);
  const profile = getProfile(profileId);
  return {
    id: typeof r.id === "string" && r.id ? r.id : `t${i + 1}`,
    name: typeof r.name === "string" && r.name ? r.name.slice(0, 80) : getInstrument(instrumentId).name,
    instrumentId,
    role: oneOf(r.role, ROLE_IDS, "ostinato"),
    pinned: bool(r.pinned, false),
    locked: bool(r.locked, false),
    engine: sanitizeEngine(r.engine, { ...getInstrument(instrumentId).defaults, instrumentId }),
    mix: { gain: num(m.gain, 0.8, 0, 2), pan: num(m.pan, 0, -1, 1), mute: bool(m.mute, false), solo: bool(m.solo, false), reverb: num(m.reverb, profile.reverb, 0, 1), delay: num(m.delay, 0, 0, 1) },
    damp: oneOf(r.damp, ["auto", "ring", "damp"] as const, "auto"),
    color: typeof r.color === "string" && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : "#3f9088",
    seed: Math.round(num(r.seed, i + 1, 0, 2 ** 32)),
    variation: Math.round(num(r.variation, 0, 0, 1e6)),
    notes: sanitizeNotes(r.notes),
  };
}

export function parseProject(text: string): { composition: Composition | null; error: string | null } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { composition: null, error: "That file is not valid JSON." };
  }
  const r = obj(raw);
  if (r.format !== PROJECT_FORMAT) return { composition: null, error: "That file is not a GLOCKWORK ensemble project." };
  if (typeof r.version !== "number" || r.version > PROJECT_VERSION) return { composition: null, error: `That project was saved by a newer version of GLOCKWORK (format ${String(r.version)}).` };
  const settings = sanitizeSettings(r.settings);
  const s = obj(r.seeds);
  const fallbackSeeds = seedsFrom(Math.round(num(s.master, 1, 0, 2 ** 32)));
  const seeds = { ...fallbackSeeds };
  for (const k of Object.keys(seeds) as (keyof typeof seeds)[]) seeds[k] = Math.round(num(s[k], fallbackSeeds[k], 0, 2 ** 32));
  const l = obj(r.locks);
  const locks = { ...NO_LOCKS };
  for (const k of Object.keys(locks) as (keyof typeof locks)[]) locks[k] = bool(l[k], false);
  const p = obj(r.plan);
  if (!Array.isArray(p.sections) || !Array.isArray(p.harmony)) return { composition: null, error: "The project's musical plan is missing or damaged." };
  const plan = {
    ...(p as unknown as Plan),
    key: Math.round(num(p.key, 0, 0, 11)),
    scale: oneOf(p.scale, SCALE_IDS, "majorPent"),
    meter: oneOf(p.meter, METER_IDS, "4/4"),
    bpm: num(p.bpm, 100, 30, 240),
    bars: Math.round(num(p.bars, 16, 1, 100000)),
    phraseBars: Math.round(num(p.phraseBars, 4, 1, 16)),
    themes: obj(p.themes) as Plan["themes"],
  };
  const tracksRaw = Array.isArray(r.tracks) ? r.tracks.slice(0, 32) : [];
  const tracks = tracksRaw.map((t, i) => sanitizeTrack(t, i, settings.profile));
  const ids = new Set<string>();
  for (const t of tracks) {
    while (ids.has(t.id)) t.id += "b";
    ids.add(t.id);
  }
  const m = obj(r.master);
  const dm = defaultMaster(getProfile(settings.profile));
  const master = { gain: num(m.gain, dm.gain, 0, 1.5), reverbSize: num(m.reverbSize, dm.reverbSize, 0, 1), reverbDecay: num(m.reverbDecay, dm.reverbDecay, 0, 1), delayBeats: num(m.delayBeats, dm.delayBeats, 0.125, 8), delayFeedback: num(m.delayFeedback, dm.delayFeedback, 0, 0.9) };
  const composition: Composition = { format: PROJECT_FORMAT, version: 1, name: typeof r.name === "string" ? r.name.slice(0, 120) : "Untitled ensemble", settings, seeds, locks, plan, tracks, master };
  return { composition, error: null };
}
