import { calculateMbpsNum } from '../utils.ts';

export interface IntervalSample {
  bytes: number;
  durationMs: number;
}

export function calculatePeakSustained(samples: number[]): string {
  if (samples.length < 4) {
    const sum = samples.reduce((a, b) => a + b, 0);
    return (samples.length > 0 ? sum / samples.length : 0).toFixed(2);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const dropBottom = Math.floor(sorted.length * 0.3);
  const dropTop = Math.floor(sorted.length * 0.1);
  const valid = sorted.slice(dropBottom, sorted.length - dropTop);
  const sum = valid.reduce((a, b) => a + b, 0);
  return (sum / valid.length).toFixed(2);
}

export function calculateWindowMbps(intervals: IntervalSample[], windowMs = 2000): number {
  let totalWindowBytes = 0;
  let totalWindowDuration = 0;
  for (let i = intervals.length - 1; i >= 0; i--) {
    const item = intervals[i];
    if (!item) continue;
    totalWindowBytes += item.bytes;
    totalWindowDuration += item.durationMs;
    if (totalWindowDuration >= windowMs) break;
  }
  return calculateMbpsNum(totalWindowBytes, totalWindowDuration);
}
