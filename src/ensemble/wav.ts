// WAV (RIFF PCM) encoding: 16-bit with TPDF dither, or 24-bit.

export function encodeWav(buf: AudioBuffer, bits: 16 | 24 = 16): Uint8Array {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const bytes = bits / 8;
  const dataLen = n * ch * bytes;
  const out = new Uint8Array(44 + dataLen);
  const v = new DataView(out.buffer);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i);
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + dataLen, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * ch * bytes, true);
  v.setUint16(32, ch * bytes, true);
  v.setUint16(34, bits, true);
  str(36, "data");
  v.setUint32(40, dataLen, true);
  const chans = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  let seed = 22222;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const x = Math.max(-1, Math.min(1, chans[c][i] || 0));
      if (bits === 16) {
        const dither = (rand() - rand()) / 32768;
        const s = Math.max(-32768, Math.min(32767, Math.round((x + dither) * 32767)));
        v.setInt16(o, s, true);
        o += 2;
      } else {
        const s = Math.max(-8388608, Math.min(8388607, Math.round(x * 8388607)));
        out[o] = s & 0xff;
        out[o + 1] = (s >> 8) & 0xff;
        out[o + 2] = (s >> 16) & 0xff;
        o += 3;
      }
    }
  }
  return out;
}

/** Minimal reader (for tests): channels, sample rate, bit depth, frames and peak. */
export function decodeWavInfo(bytes: Uint8Array): { channels: number; sampleRate: number; bits: number; frames: number; peak: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channels = v.getUint16(22, true);
  const sampleRate = v.getUint32(24, true);
  const bits = v.getUint16(34, true);
  const dataLen = v.getUint32(40, true);
  const frames = dataLen / (channels * (bits / 8));
  let peak = 0;
  if (bits === 16) for (let i = 44; i < 44 + dataLen; i += 2) peak = Math.max(peak, Math.abs(v.getInt16(i, true)) / 32768);
  return { channels, sampleRate, bits, frames, peak };
}
