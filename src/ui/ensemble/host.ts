// Control hosts for the ENSEMBLE workspace: they let GLOCKWORK's own knobs, switches and the whole
// instrument panel bind to ensemble settings and to one track's sound, exactly as they bind to the
// Sound Lab's patch — MIDI Learn included.

import type { EngineParams } from "../../audio/types";
import type { EnsembleStore } from "../../ensemble/store";
import type { AppStore } from "../../state/store";
import { Emitter } from "../../utils/events";
import type { InstrumentHost } from "../components/host";

function getDeep(obj: unknown, keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

/** Paths: controls.<k>, settings.<k>, master.<k>, track.<id>.mix.<k>, track.<id>.engine.<…> */
export function ensembleGet(store: EnsembleStore, path: string): unknown {
  const [root, ...rest] = path.split(".");
  if (root === "controls") return getDeep(store.settings.controls, rest);
  if (root === "settings" && rest[0] === "bpm" && store.settings.bpm === "auto") return store.plan.bpm;
  if (root === "settings") return getDeep(store.settings, rest);
  if (root === "master") return getDeep(store.composition.master, rest);
  if (root === "track") {
    const [id, kind, ...k] = rest;
    const t = store.track(id);
    if (!t) return undefined;
    return kind === "mix" ? getDeep(t.mix, k) : kind === "engine" ? getDeep(t.engine, k) : undefined;
  }
  return undefined;
}

export function ensembleSet(store: EnsembleStore, path: string, value: number | boolean | string): void {
  const [root, ...rest] = path.split(".");
  if (root === "controls" && typeof value === "number") store.setControl(rest[0] as keyof EnsembleStore["settings"]["controls"], value);
  else if (root === "settings") store.setSetting(rest[0] as keyof EnsembleStore["settings"], value as never);
  else if (root === "master" && typeof value === "number") store.setMaster({ [rest[0]]: value });
  else if (root === "track") {
    const [id, kind, ...k] = rest;
    if (kind === "mix") store.setTrackMix(id, { [k[0]]: value });
    else if (kind === "engine") store.setTrackEngine(id, k, value);
  }
}

/** A host over the ensemble store (composer controls, master, mix). */
export class EnsembleHost {
  readonly events = new Emitter<{ change: void }>();
  constructor(private store: EnsembleStore, private app: AppStore) {
    store.events.on("change", () => this.events.emit("change", undefined));
  }
  getByPath(path: string): unknown {
    return ensembleGet(this.store, path);
  }
  setByPath(path: string, value: number | boolean | string): void {
    ensembleSet(this.store, path, value);
  }
  beginMidiLearn(path: string, min: number, max: number, label: string): void {
    this.app.beginMidiLearn(`ensemble.${path}`, min, max, label);
  }
}

/** A host over one track's patch, shaped like the Sound Lab so the instrument panel works on it. */
export class TrackHost implements InstrumentHost {
  readonly events = new Emitter<{ change: void }>();
  private off: () => void;
  constructor(private store: EnsembleStore, private app: AppStore, readonly trackId: string) {
    this.off = store.events.on("change", () => this.events.emit("change", undefined));
  }
  private path(p: string): string {
    return `track.${this.trackId}.${p}`;
  }
  getByPath(path: string): unknown {
    return ensembleGet(this.store, this.path(path));
  }
  setByPath(path: string, value: number | boolean | string): void {
    ensembleSet(this.store, this.path(path), value);
  }
  beginMidiLearn(path: string, min: number, max: number, label: string): void {
    this.app.beginMidiLearn(`ensemble.${this.path(path)}`, min, max, label);
  }
  getEngineParams(): EngineParams {
    return this.store.track(this.trackId)!.engine;
  }
  setInstrument(id: string): void {
    this.store.setTrackInstrument(this.trackId, id);
  }
  dispose(): void {
    this.off();
  }
}
