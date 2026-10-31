import type { EngineParams } from "../../audio/types";

/** What a control needs from whatever it is bound to: read and write a dot path, arm MIDI Learn,
 *  and hear about changes. The Sound Lab's AppStore is one host; each ensemble track is another. */
export interface ControlHost {
  getByPath(path: string): unknown;
  setByPath(path: string, value: number | boolean | string): void;
  beginMidiLearn(path: string, min: number, max: number, label: string): void;
  events: { on(event: "change", fn: () => void): () => void };
}

/** A host that also has an instrument patch (the instrument panel's needs). */
export interface InstrumentHost extends ControlHost {
  getEngineParams(): EngineParams;
  setInstrument(id: string): void;
}
