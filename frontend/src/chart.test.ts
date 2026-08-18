import { describe, expect, it } from 'vitest';
import { drawAreaChart } from './chart.ts';

describe('drawAreaChart()', () => {
  it('returns an empty string when rawData is empty', (): void => {
    const result = drawAreaChart([], '--dl-color');
    expect(result).toBe('');
  });

  it('returns an empty string when prepended data length is less than two', (): void => {
    const result = drawAreaChart([], '--dl-color');
    expect(result).toBe('');
  });

  it('generates svg markup with area, line, and hit area paths for valid data', (): void => {
    const result = drawAreaChart([10, 20, 30], '--dl-color');
    expect(result).toContain('<defs>');
    expect(result).toContain('<linearGradient id="grad-dlcolor"');
    expect(result).toContain('stop-color="var(--dl-color)"');
    expect(result).toContain('fill="url(#grad-dlcolor)"');
    expect(result).toContain('class="chart-hit-area"');
    expect(result).toContain('M 0,100 L');
  });

  it('sanitizes special characters in color variable for gradient identifier', (): void => {
    const result = drawAreaChart([5, 10], '--ul-custom_color$123');
    expect(result).toContain('id="grad-ulcustomcolor123"');
    expect(result).toContain('url(#grad-ulcustomcolor123)');
  });

  it('handles dataset with all zeroes without division by zero', (): void => {
    const result = drawAreaChart([0, 0, 0], '--ping-color');
    expect(result).toContain('M 0,100 L 333.3333333333333,100 L 666.6666666666666,100 L 1000,100');
    expect(result).toContain('fill="url(#grad-pingcolor)"');
  });
});
