import { describe, expect, it } from "vitest";
import { compose, defaultSettings, seedsFrom } from "../../src/compose/composer";
import type { Composition } from "../../src/compose/types";
import { compositionToMidi, parseMidi, PPQ } from "../../src/ensemble/midi";
import { parseProject, serializeProject } from "../../src/ensemble/project";
import { dueIn, loopWindows, wrapLoop } from "../../src/ensemble/schedule";
import { decodeWavInfo, encodeWav } from "../../src/ensemble/wav";
import { listZip, zipParts } from "../../src/ensemble/zip";
import { barBeats } from "../../src/theory/meter";

const c: Composition = compose({ settings: { ...defaultSettings(), profile: "traditional", instruments: 12, bars: 32, meter: "6/8", key: 7, scale: "majorPent", bpm: 104 }, seeds: seedsFrom(31) }).composition;

describe("scheduling", () => {
  it("every note is due exactly once when a piece is walked in arbitrary windows", () => {
    const end = c.plan.bars * barBeats(c.plan.meter);
    const seen = new Map<string, number>();
    let b = 0;
    let k = 0;
    while (b < end) {
      const w = [0.013, 0.2, 0.37, 1.1][k++ % 4];
      for (const d of dueIn(c.tracks, b, b + w)) seen.set(`${d.track.id}:${d.note.id}`, (seen.get(`${d.track.id}:${d.note.id}`) ?? 0) + 1);
      b += w;
    }
    const total = c.tracks.reduce((s, t) => s + t.notes.length, 0);
    expect(seen.size).toBe(total);
    expect(Math.max(...seen.values())).toBe(1);
  });
  it("loop windows wrap at the loop end without gaps or overlaps", () => {
    const loop = { on: true, start: 8, end: 12 };
    const ws = loopWindows(10.5, 6, loop);
    expect(ws.map((w) => [w.from, w.to, w.offset])).toEqual([[10.5, 12, 0], [8, 12, 1.5], [8, 8.5, 5.5]]);
    expect(wrapLoop(13, loop)).toBe(9);
    expect(wrapLoop(5, loop)).toBe(5);
  });
});

describe("MIDI export", () => {
  const midi = parseMidi(compositionToMidi(c));
  it("writes a format-1 file with tempo, meter, key signature and section markers", () => {
    expect(midi.format).toBe(1);
    expect(midi.ppq).toBe(PPQ);
    expect(midi.usPerBeat).toBe(Math.round(60_000_000 / 104));
    expect(midi.timeSig).toEqual([6, 8]);
    expect(midi.keySig).toEqual([1, 0]); // G major: one sharp
    expect(midi.markers.length).toBe(c.plan.sections.length);
  });
  it("one named track per instrument, never on the percussion channel, notes and timing exact", () => {
    const parts = midi.tracks.slice(1);
    expect(parts).toHaveLength(12);
    for (let i = 0; i < 12; i++) {
      const t = c.tracks[i];
      const m = parts[i];
      expect(m.name).toBe(t.name);
      expect(m.channel).not.toBe(9);
      expect(m.notes).toHaveLength(t.notes.length);
      const tr = t.engine.pitch.octave * 12 + t.engine.pitch.semitone;
      const want = [...t.notes].sort((a, b) => Math.round(a.start * PPQ) - Math.round(b.start * PPQ) || a.midi - b.midi);
      m.notes.forEach((n, k) => {
        expect(n.tick).toBe(Math.round(want[k].start * PPQ));
        expect(n.midi).toBe(want[k].midi + tr);
        expect(n.vel).toBe(Math.max(1, Math.min(127, Math.round(want[k].vel * 127))));
      });
    }
  });
});

describe("project files", () => {
  it("save and load is lossless", () => {
    const back = parseProject(serializeProject(c));
    expect(back.error).toBeNull();
    expect(back.composition).toEqual(c);
  });
  it("damaged fields fall back safely; foreign files are refused", () => {
    const raw = JSON.parse(serializeProject(c));
    raw.tracks[0].instrumentId = "kazoo";
    raw.tracks[1].notes[0].midi = "high";
    raw.tracks[2].mix.gain = 99;
    raw.settings.controls.density = -4;
    const r = parseProject(JSON.stringify(raw));
    expect(r.error).toBeNull();
    expect(r.composition!.tracks[0].instrumentId).toBe("orff-alto-xylo");
    expect(r.composition!.tracks[1].notes.length).toBe(c.tracks[1].notes.length - 1);
    expect(r.composition!.tracks[2].mix.gain).toBe(2);
    expect(r.composition!.settings.controls.density).toBe(0);
    expect(parseProject("{not json").error).toMatch(/JSON/);
    expect(parseProject(JSON.stringify({ format: "mallet-synth-preset" })).error).toMatch(/not a GLOCKWORK ensemble/);
    expect(parseProject(JSON.stringify({ ...raw, version: 99 })).error).toMatch(/newer version/);
  });
});

describe("WAV and ZIP", () => {
  const fake = (seconds: number, sr = 48000) => {
    const n = Math.round(seconds * sr);
    const chans = [new Float32Array(n), new Float32Array(n)];
    for (let i = 0; i < n; i++) chans[0][i] = chans[1][i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr);
    return { numberOfChannels: 2, length: n, sampleRate: sr, duration: seconds, getChannelData: (ch: number) => chans[ch] } as unknown as AudioBuffer;
  };
  it("encodes 16- and 24-bit PCM with correct headers", () => {
    const w16 = decodeWavInfo(encodeWav(fake(0.5), 16));
    expect(w16).toMatchObject({ channels: 2, sampleRate: 48000, bits: 16, frames: 24000 });
    expect(w16.peak).toBeCloseTo(0.5, 2);
    expect(decodeWavInfo(encodeWav(fake(0.25), 24))).toMatchObject({ bits: 24, frames: 12000 });
  });
  it("store-only ZIP lists its entries with valid CRCs", () => {
    const parts = zipParts([{ name: "01 Alto Xylophone.wav", data: encodeWav(fake(0.1)) }, { name: "02 Bass.wav", data: new Uint8Array([1, 2, 3]) }]);
    const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) {
      all.set(p, o);
      o += p.length;
    }
    const list = listZip(all);
    expect(list.map((x) => x.name)).toEqual(["01 Alto Xylophone.wav", "02 Bass.wav"]);
    expect(list.every((x) => x.crcOk)).toBe(true);
  });
});
