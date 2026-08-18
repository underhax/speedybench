import { describe, expect, it } from 'vitest';
import { calculateMbps } from './utils.ts';

describe('calculateMbps()', () => {
  it('calculates megabits per second correctly for valid inputs', (): void => {
    const bytes = 1250000;
    const ms = 1000;
    const result = calculateMbps(bytes, ms);
    expect(result).toBe('10.60');
  });

  it('returns zero string when time is zero to prevent division by zero', (): void => {
    const result = calculateMbps(1000, 0);
    expect(result).toBe('0.00');
  });

  it('handles zero bytes correctly', (): void => {
    const result = calculateMbps(0, 1000);
    expect(result).toBe('0.00');
  });
});
