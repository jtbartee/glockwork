import { clamp } from "../utils/math";
import { Emitter } from "../utils/events";
import { MidiClockTracker } from "./clockTracker";

export interface MidiDeviceInfo {
  id: string;
  name: string;
  manufacturer: string;
  state: MIDIPortDeviceState;
}

export type MidiChannelFilter = "omni" | number;

export interface MidiManagerDeps {
  onNoteOn: (note: number, velocity01: number) => void;
  onNoteOff: (note: number) => void;
  onSustain: (on: boolean) => void;
  onPitchBend: (value: number) => void;
  onModWheel: (value01: number) => void;
  onCC: (cc: number, value01: number) => void;
  onClockTick: (bpm: number | null) => void;
  onClockStart: () => void;
  onClockStop: () => void;
  onClockContinue: () => void;
}

interface MidiEvents {
  "devices-changed": MidiDeviceInfo[];
  activity: { deviceId: string };
  [key: string]: unknown;
}

/** Thin wrapper around the Web MIDI API: device enumeration/selection, channel filtering,
 * and message decoding. Keeps all raw MIDIMessageEvent handling out of the rest of the app. */
export class MidiManager {
  readonly events = new Emitter<MidiEvents>();
  private access: MIDIAccess | null = null;
  private inputs = new Map<string, MIDIInput>();
  private selectedInputId: string | "any" = "any";
  private channelFilter: MidiChannelFilter = "omni";
  private clock = new MidiClockTracker();

  constructor(private deps: MidiManagerDeps) {}

  async init(): Promise<boolean> {
    if (!navigator.requestMIDIAccess) return false;
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch {
      return false;
    }
    this.access.onstatechange = () => this.refreshInputs();
    this.refreshInputs();
    return true;
  }

  isSupported(): boolean {
    return this.access !== null;
  }

  private refreshInputs(): void {
    if (!this.access) return;
    for (const input of this.inputs.values()) input.onmidimessage = null;
    this.inputs.clear();
    this.access.inputs.forEach((input) => this.inputs.set(input.id, input));
    for (const input of this.inputs.values()) {
      input.onmidimessage = (e) => this.handleMessage(input.id, e);
    }
    this.events.emit("devices-changed", this.getDeviceList());
  }

  getDeviceList(): MidiDeviceInfo[] {
    return Array.from(this.inputs.values()).map((i) => ({
      id: i.id,
      name: i.name ?? "Unknown device",
      manufacturer: i.manufacturer ?? "",
      state: i.state,
    }));
  }

  setSelectedInput(id: string | "any"): void {
    this.selectedInputId = id;
  }

  getSelectedInput(): string | "any" {
    return this.selectedInputId;
  }

  setChannelFilter(filter: MidiChannelFilter): void {
    this.channelFilter = filter;
  }

  getChannelFilter(): MidiChannelFilter {
    return this.channelFilter;
  }

  private handleMessage(deviceId: string, event: MIDIMessageEvent): void {
    if (this.selectedInputId !== "any" && deviceId !== this.selectedInputId) return;
    const data = event.data;
    if (!data || data.length === 0) return;
    const status = data[0];

    // Realtime messages have no channel and must pass through regardless of channel filter.
    if (status === 0xf8) {
      this.deps.onClockTick(this.clock.onTick(event.timeStamp));
      return;
    }
    if (status === 0xfa) {
      this.clock.reset();
      this.deps.onClockStart();
      return;
    }
    if (status === 0xfb) {
      this.deps.onClockContinue();
      return;
    }
    if (status === 0xfc) {
      this.deps.onClockStop();
      return;
    }

    const type = status & 0xf0;
    const channel = (status & 0x0f) + 1;
    if (this.channelFilter !== "omni" && channel !== this.channelFilter) return;

    this.events.emit("activity", { deviceId });

    if (type === 0x90 && data.length >= 3) {
      const note = data[1];
      const velocity = data[2];
      if (velocity > 0) this.deps.onNoteOn(note, velocity / 127);
      else this.deps.onNoteOff(note);
      return;
    }
    if (type === 0x80 && data.length >= 2) {
      this.deps.onNoteOff(data[1]);
      return;
    }
    if (type === 0xb0 && data.length >= 3) {
      const cc = data[1];
      const value = data[2];
      if (cc === 64) this.deps.onSustain(value >= 64);
      if (cc === 1) this.deps.onModWheel(value / 127);
      this.deps.onCC(cc, value / 127);
      return;
    }
    if (type === 0xe0 && data.length >= 3) {
      const raw = (data[2] << 7) | data[1];
      this.deps.onPitchBend(clamp((raw - 8192) / 8192, -1, 1));
    }
  }
}
