import { describe, expect, it } from 'vitest';
import { calculatePeakSustained, calculateWindowMbps } from './calc.ts';

describe('calculatePeakSustained()', () => {
  it('calculates average for fewer than 4 samples', (): void => {
    expect(calculatePeakSustained([])).toBe('0.00');
    expect(calculatePeakSustained([10])).toBe('10.00');
    expect(calculatePeakSustained([10, 20])).toBe('15.00');
    expect(calculatePeakSustained([10, 20, 30])).toBe('20.00');
  });

  it('drops bottom 30 percent and top 10 percent for 4 or more samples', (): void => {
    const samples = [100, 10, 20, 30, 40, 50, 60, 70, 80, 90];
    const result = calculatePeakSustained(samples);
    expect(result).toBe('65.00');
  });
});

describe('calculateWindowMbps()', () => {
  it('calculates megabits per second over sliding window', (): void => {
    const intervals = [
      { bytes: 125000, durationMs: 500 },
      { bytes: 250000, durationMs: 500 },
      { bytes: 375000, durationMs: 1000 },
    ];
    const result = calculateWindowMbps(intervals, 2000);
    expect(result).toBeGreaterThan(0);
  });

  it('handles empty intervals array', (): void => {
    expect(calculateWindowMbps([])).toBe(0);
  });

  it('handles intervals with missing or empty items', (): void => {
    const intervals = [
      { bytes: 125000, durationMs: 500 },
      undefined as unknown as { bytes: number; durationMs: number },
      { bytes: 250000, durationMs: 500 },
    ];
    const result = calculateWindowMbps(intervals, 1000);
    expect(result).toBeGreaterThan(0);
  });
});
