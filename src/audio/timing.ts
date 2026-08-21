export const ARP_RATES = ["1/1", "1/2", "1/4", "1/8", "1/8T", "1/16", "1/16T", "1/32"] as const;
export type ArpRate = (typeof ARP_RATES)[number];

const RATE_BEATS: Record<ArpRate, number> = {
  "1/1": 4,
  "1/2": 2,
  "1/4": 1,
  "1/8": 0.5,
  "1/8T": 1 / 3,
  "1/16": 0.25,
  "1/16T": 1 / 6,
  "1/32": 0.125,
};

/** Converts a note-division rate to seconds at a given BPM (quarter note = 1 beat). */
export function rateToSeconds(rate: ArpRate, bpm: number): number {
  const beatSeconds = 60 / Math.max(1, bpm);
  return beatSeconds * RATE_BEATS[rate];
}
