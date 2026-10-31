// STANDARD MIDI FILE export (format 1) from the composition's note events — the same events the
// transport plays and the renderer renders. Track 0 carries tempo, meter, key signature and
// section markers; each instrument part is its own named track on its own channel (channel 10 is
// skipped: it is percussion in General MIDI) with a General MIDI program close to its instrument.
// Pitches are sounding pitches plus the patch's own octave/semitone transposition.

import { barBeats, METERS } from "../theory/meter";
import { isMinorish } from "../theory/scales";
import type { Composition } from "../compose/types";

export const PPQ = 480;

export const GM_PROGRAM: Record<string, number> = {
  "orff-soprano-glock": 9, "orff-alto-glock": 9, "orchestral-bells": 9, crotales: 112, "orff-soprano-xylo": 13, "orff-alto-xylo": 13,
  "orff-bass-xylo": 13, "concert-xylo": 13, "orff-soprano-metal": 11, "orff-alto-metal": 11, "orff-bass-metal": 11, marimba: 12,
  vibraphone: 11, "tubular-bells": 14, celesta: 8, kalimba: 108, "toy-piano": 10, "steel-tongue": 114, "wooden-tongue": 115, bell: 112,
  "glass-mallet": 98, "synthetic-mallet": 98,
};

function vlq(n: number): number[] {
  let v = Math.max(0, Math.round(n));
  const out = [v & 0x7f];
  v >>= 7;
  while (v > 0) {
    out.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return out;
}

const text = (s: string) => [...new TextEncoder().encode(s)];

interface Ev {
  tick: number;
  order: number;
  bytes: number[];
}

function chunk(type: string, data: number[]): number[] {
  const len = data.length;
  return [...text(type), (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff, ...data];
}

function trackBytes(events: Ev[]): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const out: number[] = [];
  let last = 0;
  for (const e of events) {
    out.push(...vlq(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  out.push(0, 0xff, 0x2f, 0);
  return out;
}

/** Key signature (sharps/flats count, minor flag) for a key and scale. */
export function keySignature(key: number, scale: Composition["plan"]["scale"]): [number, number] {
  const minor = isMinorish(scale);
  const major = minor ? (key + 3) % 12 : key;
  const SF: Record<number, number> = { 0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 5: -1, 10: -2, 3: -3, 8: -4, 1: -5 };
  return [SF[major] ?? 0, minor ? 1 : 0];
}

export interface MidiExportOptions {
  includeMuted?: boolean;
}

export function compositionToMidi(c: Composition, o: MidiExportOptions = {}): Uint8Array {
  const p = c.plan;
  const meter = METERS[p.meter];
  const bb = barBeats(p.meter);
  const tick = (beat: number) => Math.max(0, Math.round(beat * PPQ));
  const head: Ev[] = [];
  const usPerBeat = Math.round(60_000_000 / p.bpm);
  head.push({ tick: 0, order: 0, bytes: [0xff, 0x03, ...vlq(text(c.name).length), ...text(c.name)] });
  head.push({ tick: 0, order: 1, bytes: [0xff, 0x51, 0x03, (usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff] });
  head.push({ tick: 0, order: 2, bytes: [0xff, 0x58, 0x04, meter.num, Math.round(Math.log2(meter.den)), 24, 8] });
  const [sf, mi] = keySignature(p.key, p.scale);
  head.push({ tick: 0, order: 3, bytes: [0xff, 0x59, 0x02, sf & 0xff, mi] });
  for (const s of p.sections) {
    const label = `${s.label} — ${s.name}`;
    head.push({ tick: tick(s.startBar * bb), order: 4, bytes: [0xff, 0x06, ...vlq(text(label).length), ...text(label)] });
  }
  const tracks = [trackBytes(head)];
  const anySolo = c.tracks.some((t) => t.mix.solo);
  let ch = 0;
  for (const t of c.tracks) {
    const audible = anySolo ? t.mix.solo : !t.mix.mute;
    if (!audible && !o.includeMuted) continue;
    const channel = ch === 9 ? ++ch : ch;
    ch = (channel + 1) % 16;
    const evs: Ev[] = [];
    evs.push({ tick: 0, order: 0, bytes: [0xff, 0x03, ...vlq(text(t.name).length), ...text(t.name)] });
    evs.push({ tick: 0, order: 1, bytes: [0xff, 0x04, ...vlq(text(t.instrumentId).length), ...text(t.instrumentId)] });
    evs.push({ tick: 0, order: 2, bytes: [0xc0 | channel, GM_PROGRAM[t.instrumentId] ?? 12] });
    const pan = Math.round(64 + t.mix.pan * 63);
    evs.push({ tick: 0, order: 3, bytes: [0xb0 | channel, 10, Math.max(0, Math.min(127, pan))] });
    const transpose = t.engine.pitch.octave * 12 + t.engine.pitch.semitone;
    for (const n of t.notes) {
      const m = Math.max(0, Math.min(127, n.midi + transpose));
      const vel = Math.max(1, Math.min(127, Math.round(n.vel * 127)));
      const on = tick(n.start);
      const off = Math.max(on + 1, tick(n.start + n.dur));
      evs.push({ tick: on, order: 6, bytes: [0x90 | channel, m, vel] });
      evs.push({ tick: off, order: 5, bytes: [0x80 | channel, m, 0] });
    }
    tracks.push(trackBytes(evs));
  }
  const header = chunk("MThd", [0, 1, (tracks.length >> 8) & 0xff, tracks.length & 0xff, (PPQ >> 8) & 0xff, PPQ & 0xff]);
  return new Uint8Array([...header, ...tracks.flatMap((tb) => chunk("MTrk", tb))]);
}

export interface ParsedMidi {
  format: number;
  ppq: number;
  usPerBeat: number | null;
  timeSig: [number, number] | null;
  keySig: [number, number] | null;
  markers: { tick: number; text: string }[];
  tracks: { name: string; channel: number | null; program: number | null; notes: { tick: number; dur: number; midi: number; vel: number }[] }[];
}

/** A small SMF reader (used by the tests to check exports). */
export function parseMidi(bytes: Uint8Array): ParsedMidi {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  let p = 0;
  const id = () => dec.decode(bytes.subarray(p, p + 4));
  if (id() !== "MThd") throw new Error("not a MIDI file");
  const format = v.getUint16(8);
  const ntrk = v.getUint16(10);
  const ppq = v.getUint16(12);
  p = 14;
  const out: ParsedMidi = { format, ppq, usPerBeat: null, timeSig: null, keySig: null, markers: [], tracks: [] };
  for (let k = 0; k < ntrk; k++) {
    if (id() !== "MTrk") throw new Error("bad track chunk");
    const len = v.getUint32(p + 4);
    let q = p + 8;
    const end = q + len;
    let t = 0;
    let status = 0;
    const tr = { name: "", channel: null as number | null, program: null as number | null, notes: [] as { tick: number; dur: number; midi: number; vel: number }[] };
    const open = new Map<number, { tick: number; vel: number }[]>();
    const readVlq = () => {
      let x = 0;
      for (;;) {
        const b = bytes[q++];
        x = (x << 7) | (b & 0x7f);
        if (!(b & 0x80)) return x;
      }
    };
    while (q < end) {
      t += readVlq();
      let b = bytes[q];
      if (b & 0x80) {
        status = b;
        q++;
      } else b = status;
      if (status === 0xff) {
        const type = bytes[q++];
        const l = readVlq();
        const data = bytes.subarray(q, q + l);
        if (type === 0x03) tr.name = dec.decode(data);
        if (type === 0x51) out.usPerBeat = (data[0] << 16) | (data[1] << 8) | data[2];
        if (type === 0x58) out.timeSig = [data[0], 2 ** data[1]];
        if (type === 0x59) out.keySig = [(data[0] << 24) >> 24, data[1]];
        if (type === 0x06) out.markers.push({ tick: t, text: dec.decode(data) });
        q += l;
        continue;
      }
      const hi = status & 0xf0;
      const ch = status & 0x0f;
      if (hi === 0x90 || hi === 0x80) {
        const m = bytes[q++];
        const vel = bytes[q++];
        tr.channel = ch;
        if (hi === 0x90 && vel > 0) {
          const l = open.get(m) ?? [];
          l.push({ tick: t, vel });
          open.set(m, l);
        } else {
          const l = open.get(m);
          const s = l?.shift();
          if (s) tr.notes.push({ tick: s.tick, dur: t - s.tick, midi: m, vel: s.vel });
        }
      } else if (hi === 0xc0) {
        tr.program = bytes[q++];
        tr.channel = ch;
      } else if (hi === 0xd0) q += 1;
      else q += 2;
    }
    tr.notes.sort((a, b) => a.tick - b.tick || a.midi - b.midi);
    out.tracks.push(tr);
    p = end;
  }
  return out;
}
