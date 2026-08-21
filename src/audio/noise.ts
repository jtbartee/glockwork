const cache = new WeakMap<AudioContext, AudioBuffer>();

/** A shared, reusable white-noise buffer. Voices play random slices of it so repeated
 * strikes of the same note don't sound perfectly identical, without generating a new
 * buffer per note. */
export function getSharedNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const existing = cache.get(ctx);
  if (existing) return existing;
  const seconds = 2;
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  cache.set(ctx, buffer);
  return buffer;
}
