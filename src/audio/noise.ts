const cache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** A shared, reusable white-noise buffer. Voices play random slices of it so repeated
 * strikes of the same note don't sound perfectly identical, without generating a new
 * buffer per note. Its contents are seeded, so offline renders are reproducible. */
export function getSharedNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const existing = cache.get(ctx);
  if (existing) return existing;
  const seconds = 2;
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let x = 0x2545f491;
  for (let i = 0; i < data.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    data[i] = ((x >>> 0) / 4294967296) * 2 - 1;
  }
  cache.set(ctx, buffer);
  return buffer;
}
