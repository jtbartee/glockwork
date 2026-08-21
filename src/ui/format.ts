import { decaySeconds, filterCutoffHz, filterQ, motorHz } from "../audio/mapping";
import { rateToSeconds, type ArpRate } from "../audio/timing";

export const pct = (v: number): string => `${Math.round(v * 100)}%`;
export const hzFromCutoff = (v: number): string => {
  const hz = filterCutoffHz(v);
  return hz >= 1000 ? `${(hz / 1000).toFixed(1)}k` : `${Math.round(hz)}Hz`;
};
export const qFmt = (v: number): string => filterQ(v).toFixed(1);
export const secFromDecay = (v: number): string => {
  const s = decaySeconds(v);
  return s >= 1 ? `${s.toFixed(1)}s` : `${Math.round(s * 1000)}ms`;
};
export const hzFromMotor = (v: number): string => `${motorHz(v).toFixed(1)}Hz`;
export const semis = (v: number): string => `${v >= 0 ? "+" : ""}${Math.round(v)}`;
export const cents = (v: number): string => `${v >= 0 ? "+" : ""}${Math.round(v)}¢`;
export const octaves = (v: number): string => `${v >= 0 ? "+" : ""}${Math.round(v)}oct`;
export const ratioFmt = (v: number): string => `${v.toFixed(2)}x`;
export const bpmFmt = (v: number): string => `${Math.round(v)}`;
export const msFromRate = (rate: ArpRate, bpm: number): string => `${Math.round(rateToSeconds(rate, bpm) * 1000)}ms`;
export const plain = (v: number): string => v.toFixed(2);
