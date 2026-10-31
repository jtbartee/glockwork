// ENSEMBLE STORE. The one object the ENSEMBLE workspace talks to: it owns the current composition,
// the mixer and transport on GLOCKWORK's AudioContext, the endless performer, the undo history,
// selection and autosave. Every change goes through here so playback, the editor and exports always
// read the same note arrays.

import { getInstrument } from "../audio/instruments";
import { analyse, type Analysis } from "../compose/analysis";
import { compose, defaultSettings, NO_LOCKS, reseed, seedsFrom } from "../compose/composer";
import { EndlessComposer } from "../compose/endless";
import { getProfile } from "../compose/profiles";
import { makeTrack, profileEngine } from "../compose/roles";
import type { Beats, ComposeSettings, Composition, Locks, NoteEvent, RoleId, Track } from "../compose/types";
import { hash32, rng } from "../theory/rng";
import { barBeats } from "../theory/meter";
import { Emitter } from "../utils/events";
import { compositionToMidi } from "./midi";
import { EnsembleMixer, type Quality } from "./mixer";
import { parseProject, serializeProject } from "./project";
import { renderComposition, renderStems } from "./render";
import type { LoopRegion } from "./schedule";
import { EnsembleTransport } from "./transport";
import { encodeWav } from "./wav";
import { zipParts } from "./zip";

export type LockDomain = keyof Locks;

interface StoreEvents {
  change: void;
  notes: { trackId: string | null };
  composed: void;
  selection: void;
  transport: void;
  notice: { text: string; kind: "info" | "warn" };
  progress: { label: string; fraction: number } | null;
  [key: string]: unknown;
}

const HISTORY = 40;
const DB = "glockwork-ensemble";

export class EnsembleStore {
  readonly events = new Emitter<StoreEvents>();
  readonly mixer: EnsembleMixer;
  readonly transport: EnsembleTransport;
  composition: Composition;
  settings: ComposeSettings;
  locks: Locks = { ...NO_LOCKS };
  endless: EndlessComposer | null = null;
  selectedTrack: string | null = null;
  selectedNotes = new Set<number>();
  loop: LoopRegion = { on: false, start: 0, end: 16 };
  quality: Quality = "balanced";
  lastNotices: string[] = [];
  private undoStack: Composition[] = [];
  private redoStack: Composition[] = [];
  private analysisCache: { c: Composition; a: Analysis } | null = null;
  private saveTimer = 0;
  private busy = false;

  constructor(readonly ctx: AudioContext) {
    this.mixer = new EnsembleMixer(ctx, ctx.destination, { offline: false, quality: this.quality });
    this.transport = new EnsembleTransport(ctx, this.mixer, {
      beforeSchedule: (until) => this.feedEndless(until),
      onEnd: () => this.events.emit("transport", undefined),
    });
    this.settings = defaultSettings();
    this.settings.bars = 32;
    this.composition = compose({ settings: this.settings, seeds: seedsFrom(2026), name: "First ensemble" }).composition;
    this.installComposition(this.composition, false);
  }

  // ------------------------------------------------------------------ getters

  get plan() {
    return this.composition.plan;
  }

  get bb(): number {
    return barBeats(this.composition.plan.meter);
  }

  get lengthBeats(): Beats {
    return this.composition.plan.bars * this.bb;
  }

  track(id: string | null): Track | undefined {
    return this.composition.tracks.find((t) => t.id === id);
  }

  analysis(): Analysis {
    if (this.analysisCache?.c !== this.composition) this.analysisCache = { c: this.composition, a: analyse(this.composition) };
    return this.analysisCache.a;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0 && !this.endless;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0 && !this.endless;
  }

  // ------------------------------------------------------------------ composing

  setSetting<K extends keyof ComposeSettings>(key: K, value: ComposeSettings[K]): void {
    this.settings = { ...this.settings, [key]: value };
    this.emitChange();
  }

  setControl(key: keyof ComposeSettings["controls"], value: number): void {
    this.settings = { ...this.settings, controls: { ...this.settings.controls, [key]: value } };
    this.emitChange();
  }

  setLock(domain: LockDomain, on: boolean): void {
    this.locks = { ...this.locks, [domain]: on };
    this.composition.locks = this.locks;
    this.emitChange();
  }

  /** Compose with the current settings. `newSeed` rolls a new master seed for unlocked domains. */
  composeNow(newSeed = false, master?: number): void {
    if (this.busy) return;
    const was = this.transport.isPlaying();
    const pos = this.transport.position();
    this.transport.stop();
    this.snapshot();
    const seedMaster = master ?? (newSeed ? (Math.random() * 2 ** 31) >>> 0 : this.composition.seeds.master);
    const seeds = newSeed || master !== undefined ? reseed(this.composition.seeds, seedMaster, this.locks) : this.composition.seeds;
    if (this.settings.mode === "endless") {
      this.startEndless(seeds);
      if (was) void this.transport.play(0);
      return;
    }
    this.endless = null;
    this.transport.endless = false;
    const { composition, notices } = compose({ settings: this.settings, seeds, locks: this.locks, previous: this.composition, master: this.composition.master });
    this.lastNotices = notices;
    for (const n of notices) this.events.emit("notice", { text: n, kind: "info" });
    this.installComposition(composition, true);
    if (was) void this.transport.play(Math.min(pos, this.lengthBeats - 1));
  }

  private startEndless(seeds: Composition["seeds"]): void {
    const base = this.composition;
    this.endless = new EndlessComposer({ ...this.settings, mode: "endless" }, seeds, this.locks, base);
    // locked tracks in a performance repeat their last section
    for (const t of this.endless.composition.tracks) {
      const b = base.tracks.find((x) => x.id === t.id);
      if (b?.locked) t.locked = true;
    }
    this.endless.ensure(32);
    this.transport.endless = true;
    this.loop = { ...this.loop, on: false };
    this.transport.setLoop(null);
    this.installComposition(this.endless.composition, true);
  }

  /** The transport asks for music up to `until`: the endless performer writes ahead and forgets
   *  what is far behind the playhead. */
  private feedEndless(until: Beats): void {
    const e = this.endless;
    if (!e) return;
    const bar = Math.ceil(until / this.bb);
    if (e.ensure(bar + 16)) {
      const pos = this.transport.position();
      const behind = Math.floor(pos / this.bb) - 96;
      if (behind > 0) e.trim(behind);
      this.analysisCache = null;
      this.events.emit("notes", { trackId: null });
    }
  }

  /** Freeze bars [from, to) of the endless performance as an editable arrangement. */
  capture(fromBar?: number, toBar?: number): void {
    const e = this.endless;
    if (!e) return;
    const posBar = Math.floor(this.transport.position() / this.bb);
    const first = e.plan.sections[0]?.startBar ?? 0;
    const to = toBar ?? Math.max(first + 8, posBar);
    const from = fromBar ?? Math.max(first, to - 64);
    this.transport.stop();
    const c = e.capture(from, to);
    this.endless = null;
    this.transport.endless = false;
    this.settings = { ...this.settings, mode: "arrangement", lengthMode: "bars", bars: c.plan.bars };
    this.installComposition(c, true);
    this.events.emit("notice", { text: `Captured bars ${from + 1}–${to} as an arrangement you can edit and export.`, kind: "info" });
  }

  private installComposition(c: Composition, emit: boolean): void {
    this.composition = c;
    this.settings = { ...c.settings };
    this.locks = { ...c.locks };
    this.mixer.setComposition(c);
    this.transport.setComposition(c);
    if (!this.track(this.selectedTrack)) this.selectedTrack = c.tracks.find((t) => t.role === "melody")?.id ?? c.tracks[0]?.id ?? null;
    this.selectedNotes.clear();
    if (this.loop.end > this.lengthBeats && !this.endless) this.loop = { on: false, start: 0, end: Math.min(16, this.lengthBeats) };
    this.analysisCache = null;
    if (emit) {
      this.events.emit("composed", undefined);
      this.emitChange();
    }
  }

  /** New notes for one track only: everything else is held exactly as it is. */
  regenerateTrack(id: string): void {
    this.rewriteTrack(id, (t) => ({ ...t, seed: hash32(`${t.seed}:${Date.now()}:${Math.random()}`) }), false);
  }

  /** A variation of one track: rewritten with a new variation number, then most phrases kept from
   *  the old part so the variation stays recognisably the same part. */
  varyTrack(id: string): void {
    this.rewriteTrack(id, (t) => ({ ...t, variation: t.variation + 1 }), true);
  }

  private rewriteTrack(id: string, change: (t: Track) => Track, blend: boolean): void {
    const cur = this.composition;
    const target = this.track(id);
    if (!target || this.endless) return;
    this.snapshot();
    const prev: Composition = { ...cur, tracks: cur.tracks.map((t) => (t.id === id ? change({ ...t, locked: false }) : { ...t, locked: true })) };
    const locks: Locks = { harmony: true, arrangement: true, instruments: true, melody: false, rhythm: false };
    const { composition } = compose({ settings: cur.settings, seeds: cur.seeds, locks, previous: prev, master: cur.master });
    const fresh = composition.tracks.find((t) => t.id === id)!;
    let notes = fresh.notes;
    if (blend) {
      const r = rng(hash32(`vary:${fresh.seed}:${fresh.variation}`));
      const bb = this.bb;
      const keep = new Set<number>();
      for (const s of cur.plan.sections) for (const ph of s.phrases) if (!r.chance(0.4)) keep.add(ph.startBar);
      const phraseOf = (b: Beats) => {
        const bar = Math.floor(b / bb + 1e-6);
        let start = 0;
        for (const s of cur.plan.sections) for (const ph of s.phrases) if (ph.startBar <= bar) start = ph.startBar;
        return start;
      };
      notes = [...target.notes.filter((n) => keep.has(phraseOf(n.start))), ...fresh.notes.filter((n) => !keep.has(phraseOf(n.start)))].sort((a, b) => a.start - b.start || a.midi - b.midi);
      notes.forEach((n, i) => (n.id = i + 1));
    }
    const tracks = cur.tracks.map((t) => (t.id === id ? { ...change(t), notes } : t));
    this.composition = { ...cur, tracks };
    this.afterEdit(id);
  }

  // ------------------------------------------------------------------ history

  private snapshot(): void {
    if (this.endless) return;
    this.undoStack.push(structuredClone(this.composition));
    if (this.undoStack.length > HISTORY) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(): void {
    const c = this.undoStack.pop();
    if (!c) return;
    this.redoStack.push(this.composition);
    this.installComposition(c, true);
  }

  redo(): void {
    const c = this.redoStack.pop();
    if (!c) return;
    this.undoStack.push(this.composition);
    this.installComposition(c, true);
  }

  // ------------------------------------------------------------------ editing

  /** Apply an edit to one track's notes (undoable). Editing a track locks it so that regenerating
   *  the rest of the piece keeps the edits. */
  editNotes(trackId: string, fn: (notes: NoteEvent[]) => NoteEvent[], opts: { lock?: boolean } = {}): void {
    const t = this.track(trackId);
    if (!t || this.endless) return;
    this.snapshot();
    const next = fn(t.notes.map((n) => ({ ...n }))).filter((n) => Number.isFinite(n.start) && n.dur > 0).map((n) => ({ ...n, start: Math.max(0, n.start), midi: Math.max(0, Math.min(127, Math.round(n.midi))), vel: Math.max(0.01, Math.min(1, n.vel)) }));
    next.sort((a, b) => a.start - b.start || a.midi - b.midi);
    const tracks = this.composition.tracks.map((x) => (x.id === trackId ? { ...x, notes: next, locked: opts.lock === false ? x.locked : true } : x));
    if (!t.locked && opts.lock !== false) this.events.emit("notice", { text: `${t.name} is now locked, so regenerating keeps your edits.`, kind: "info" });
    this.composition = { ...this.composition, tracks };
    this.afterEdit(trackId);
  }

  nextNoteId(trackId: string): number {
    return (this.track(trackId)?.notes ?? []).reduce((m, n) => Math.max(m, n.id), 0) + 1;
  }

  addNote(trackId: string, n: Omit<NoteEvent, "id">): number {
    const id = this.nextNoteId(trackId);
    this.editNotes(trackId, (ns) => [...ns, { ...n, id }]);
    this.selectedNotes = new Set([id]);
    return id;
  }

  deleteNotes(trackId: string, ids: Set<number>): void {
    this.editNotes(trackId, (ns) => ns.filter((n) => !ids.has(n.id)));
    this.selectedNotes.clear();
  }

  /** Bar-range operations across tracks (all when `trackIds` is empty). */
  rangeOp(op: "delete" | "duplicate" | "copy-to", fromBar: number, toBar: number, trackIds: string[], destBar = toBar): void {
    if (this.endless) return;
    this.snapshot();
    const bb = this.bb;
    const a = fromBar * bb;
    const b = toBar * bb;
    const d = (destBar - fromBar) * bb;
    const ids = new Set(trackIds.length ? trackIds : this.composition.tracks.map((t) => t.id));
    const tracks = this.composition.tracks.map((t) => {
      if (!ids.has(t.id)) return t;
      const inside = t.notes.filter((n) => n.start >= a - 1e-6 && n.start < b - 1e-6);
      let notes = t.notes;
      if (op === "delete") notes = t.notes.filter((n) => !(n.start >= a - 1e-6 && n.start < b - 1e-6));
      else {
        // the destination range is replaced by the copied material
        const span = b - a;
        const dest0 = a + (op === "duplicate" ? span : d);
        const kept = t.notes.filter((n) => !(n.start >= dest0 - 1e-6 && n.start < dest0 + span - 1e-6));
        let next = kept.reduce((m, n) => Math.max(m, n.id), 0) + 1;
        notes = [...kept, ...inside.map((n) => ({ ...n, id: next++, start: n.start - a + dest0 }))];
      }
      notes = notes.filter((n) => n.start < this.lengthBeats).sort((x, y) => x.start - y.start || x.midi - y.midi);
      return { ...t, notes, locked: true };
    });
    this.composition = { ...this.composition, tracks };
    this.afterEdit(null);
  }

  private afterEdit(trackId: string | null): void {
    this.mixer.setComposition(this.composition);
    this.transport.setComposition(this.composition);
    this.analysisCache = null;
    this.events.emit("notes", { trackId });
    this.emitChange();
  }

  // ------------------------------------------------------------------ tracks and mix

  selectTrack(id: string | null): void {
    this.selectedTrack = id;
    this.selectedNotes.clear();
    this.events.emit("selection", undefined);
  }

  setTrackMix(id: string, patch: Partial<Track["mix"]>): void {
    const t = this.track(id);
    if (!t) return;
    t.mix = { ...t.mix, ...patch };
    this.mixer.updateTrack(t, this.composition.tracks);
    for (const x of this.composition.tracks) this.mixer.updateTrack(x, this.composition.tracks);
    this.scheduleSave();
    this.events.emit("change", undefined);
  }

  setTrackLock(id: string, locked: boolean): void {
    const t = this.track(id);
    if (!t) return;
    t.locked = locked;
    this.emitChange();
  }

  setTrackDamp(id: string, damp: Track["damp"]): void {
    const t = this.track(id);
    if (!t) return;
    t.damp = damp;
    this.emitChange();
  }

  /** Change a track's instrument (its sound becomes that instrument's; the choice is pinned). */
  setTrackInstrument(id: string, instrumentId: string): void {
    const t = this.track(id);
    if (!t) return;
    this.snapshot();
    t.instrumentId = instrumentId;
    t.engine = profileEngine(instrumentId, getProfile(this.composition.plan.profile));
    t.name = getInstrument(instrumentId).name;
    t.pinned = true;
    this.mixer.updateTrack(t, this.composition.tracks);
    this.events.emit("notice", { text: `${t.name}: compose again (or regenerate this track) to write music for it.`, kind: "info" });
    this.emitChange();
  }

  setTrackRole(id: string, role: RoleId): void {
    const t = this.track(id);
    if (!t) return;
    this.snapshot();
    t.role = role;
    t.pinned = true;
    this.emitChange();
  }

  /** Sound design for one track (dot path inside its EngineParams). */
  setTrackEngine(id: string, path: string[], value: number | boolean | string): void {
    const t = this.track(id);
    if (!t) return;
    const next = structuredClone(t.engine) as unknown as Record<string, unknown>;
    let cur = next;
    for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]] as Record<string, unknown>;
    cur[path[path.length - 1]] = value;
    t.engine = next as unknown as Track["engine"];
    this.mixer.updateTrack(t, this.composition.tracks);
    this.scheduleSave();
    this.events.emit("change", undefined);
  }

  addTrack(instrumentId: string): void {
    if (this.composition.tracks.length >= 16 || this.endless) return;
    this.snapshot();
    const n = this.composition.tracks.length;
    const ids = new Set(this.composition.tracks.map((t) => t.id));
    let k = n + 1;
    while (ids.has(`t${k}`)) k++;
    const t = makeTrack(`t${k}`, instrumentId, "ostinato", n, n + 1, getProfile(this.composition.plan.profile), (Math.random() * 2 ** 31) >>> 0, this.composition.tracks.filter((x) => x.instrumentId === instrumentId).length);
    t.pinned = true;
    this.composition = { ...this.composition, tracks: [...this.composition.tracks, t] };
    this.settings = { ...this.settings, instruments: this.composition.tracks.length };
    this.composition.settings = this.settings;
    this.afterEdit(t.id);
  }

  removeTrack(id: string): void {
    if (this.composition.tracks.length <= 1 || this.endless) return;
    this.snapshot();
    this.composition = { ...this.composition, tracks: this.composition.tracks.filter((t) => t.id !== id) };
    this.settings = { ...this.settings, instruments: this.composition.tracks.length };
    this.composition.settings = this.settings;
    if (this.selectedTrack === id) this.selectedTrack = this.composition.tracks[0]?.id ?? null;
    this.afterEdit(null);
  }

  setMaster(patch: Partial<Composition["master"]>): void {
    this.composition.master = { ...this.composition.master, ...patch };
    this.mixer.setMaster(this.composition.master, this.composition.tracks.length);
    this.scheduleSave();
    this.events.emit("change", undefined);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    this.mixer.quality = q;
    this.events.emit("change", undefined);
  }

  /** Strike one note now through a track's sound (piano-roll audition). */
  audition(trackId: string, midi: number, vel = 0.8): void {
    const t = this.track(trackId);
    if (!t) return;
    void this.ctx.resume();
    this.mixer.playNote(t, { id: -1, start: 0, dur: 0.6, midi, vel }, this.ctx.currentTime + 0.01, 60 / this.composition.plan.bpm);
  }

  // ------------------------------------------------------------------ transport

  async play(from?: Beats): Promise<void> {
    await this.transport.play(from ?? (this.loop.on ? this.loop.start : this.transport.position()));
    this.events.emit("transport", undefined);
  }

  stop(): void {
    this.transport.stop();
    this.events.emit("transport", undefined);
  }

  toggle(): void {
    if (this.transport.isPlaying()) this.stop();
    else void this.play();
  }

  seek(beat: Beats): void {
    this.transport.seek(Math.max(0, Math.min(this.endless ? beat : this.lengthBeats, beat)));
    this.events.emit("transport", undefined);
  }

  setLoop(loop: Partial<LoopRegion>): void {
    this.loop = { ...this.loop, ...loop };
    if (this.loop.end < this.loop.start + this.bb) this.loop.end = this.loop.start + this.bb;
    this.transport.setLoop(this.loop.on ? this.loop : null);
    this.events.emit("transport", undefined);
  }

  // ------------------------------------------------------------------ export and files

  exportMidi(): Uint8Array {
    return compositionToMidi(this.composition);
  }

  async renderWav(bits: 16 | 24 = 16, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<Uint8Array> {
    const buf = await renderComposition(this.composition, { quality: "high", onProgress, signal, fromBeat: this.loop.on ? this.loop.start : 0, toBeat: this.loop.on ? this.loop.end : undefined });
    return encodeWav(buf, bits);
  }

  async renderStemsZip(bits: 16 | 24 = 16, onProgress?: (f: number) => void, signal?: AbortSignal): Promise<Blob> {
    const stems = await renderStems(this.composition, { quality: "high", onProgress, signal, fromBeat: this.loop.on ? this.loop.start : 0, toBeat: this.loop.on ? this.loop.end : undefined });
    const entries = stems.map((s, i) => ({ name: `${String(i + 1).padStart(2, "0")} ${s.name.replace(/[^\w ()-]+/g, "-")}.wav`, data: encodeWav(s.buffer, bits) }));
    return new Blob(zipParts(entries), { type: "application/zip" });
  }

  saveProject(): string {
    return serializeProject({ ...this.composition, settings: this.settings, locks: this.locks });
  }

  loadProject(text: string): string | null {
    const { composition, error } = parseProject(text);
    if (!composition) return error;
    this.transport.stop();
    this.snapshot();
    this.endless = null;
    this.transport.endless = false;
    this.installComposition(composition, true);
    return null;
  }

  rename(name: string): void {
    this.composition.name = name.slice(0, 120) || "Untitled ensemble";
    this.emitChange();
  }

  // ------------------------------------------------------------------ persistence

  private emitChange(): void {
    this.scheduleSave();
    this.events.emit("change", undefined);
  }

  private scheduleSave(): void {
    if (typeof window === "undefined") return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.persist(), 1200);
  }

  private async db(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === "undefined") return null;
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore("session");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  private async persist(): Promise<void> {
    if (this.endless) return;
    const db = await this.db();
    if (!db) return;
    try {
      const tx = db.transaction("session", "readwrite");
      tx.objectStore("session").put({ project: this.saveProject(), quality: this.quality, loop: this.loop, selected: this.selectedTrack }, "current");
    } catch {
      /* storage full or unavailable: the session just is not kept */
    }
  }

  /** Restore the last session, if there is one. */
  async restore(): Promise<boolean> {
    const db = await this.db();
    if (!db) return false;
    const rec = await new Promise<{ project?: string; quality?: Quality; loop?: LoopRegion; selected?: string } | null>((resolve) => {
      try {
        const req = db.transaction("session", "readonly").objectStore("session").get("current");
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    if (!rec?.project) return false;
    const { composition } = parseProject(rec.project);
    if (!composition) return false;
    if (rec.quality) this.setQuality(rec.quality);
    this.installComposition(composition, true);
    if (rec.loop) this.loop = { ...rec.loop, on: false };
    if (rec.selected && this.track(rec.selected)) this.selectedTrack = rec.selected;
    return true;
  }

  async clearSession(): Promise<void> {
    const db = await this.db();
    try {
      db?.transaction("session", "readwrite").objectStore("session").delete("current");
    } catch {
      /* ignore */
    }
  }
}
