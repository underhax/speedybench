import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculateMbps, copyToClipboard, formatSamplesTSV } from './utils.ts';

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

describe('formatSamplesTSV()', () => {
  it('formats samples into tab-separated values with metadata at the bottom', (): void => {
    const samples = [
      { bytes: 1048576, speed: 100.5, timeMs: 1000 },
      { bytes: 5242880, speed: 250.75, timeMs: 2500 },
    ];
    const result = formatSamplesTSV(samples, {
      finalSpeed: '250.75',
      methodLabel: 'Method',
      methodValue: 'Cumulative Average',
      totalLabel: 'Total (Download)',
    });
    expect(result).toBe(
      'Time (ms)\tSize (MB)\tSpeed (Mbps)\n1000\t1.00\t100.50\n2500\t5.00\t250.75\n\nMethod\tCumulative Average\nTotal (Download)\t250.75',
    );
  });

  it('formats samples without metadata when omitted', (): void => {
    const samples = [{ bytes: 1048576, speed: 100.5, timeMs: 1000 }];
    const result = formatSamplesTSV(samples);
    expect(result).toBe('Time (ms)\tSize (MB)\tSpeed (Mbps)\n1000\t1.00\t100.50');
  });

  it('returns only column header when samples array is empty', (): void => {
    const result = formatSamplesTSV([]);
    expect(result).toBe('Time (ms)\tSize (MB)\tSpeed (Mbps)');
  });
});

describe('copyToClipboard()', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses ClipboardItem with text/plain format', async (): Promise<void> => {
    const writeMock = vi.fn().mockResolvedValue(undefined);
    class MockClipboardItem {
      types: Record<string, Blob>;
      constructor(data: Record<string, Blob>) {
        this.types = data;
      }
    }
    vi.stubGlobal('ClipboardItem', MockClipboardItem);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write: writeMock },
    });

    const result = await copyToClipboard('plain text');
    expect(result).toBe(true);
    expect(writeMock).toHaveBeenCalled();
  });

  it('uses navigator.clipboard.writeText when available', async (): Promise<void> => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    });

    const result = await copyToClipboard('test data');
    expect(result).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith('test data');
  });

  it('falls back to document.execCommand when clipboard API fails', async (): Promise<void> => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('Permission denied')) },
    });
    document.execCommand = vi.fn().mockReturnValue(true);

    const result = await copyToClipboard('test data');
    expect(result).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('returns false when both clipboard API and fallback fail', async (): Promise<void> => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('Permission denied')) },
    });
    document.execCommand = vi.fn().mockImplementation(() => {
      throw new Error('execCommand error');
    });

    const result = await copyToClipboard('test data');
    expect(result).toBe(false);
  });

  it('falls back to document.execCommand when navigator.clipboard is undefined', async (): Promise<void> => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    document.execCommand = vi.fn().mockReturnValue(true);

    const result = await copyToClipboard('fallback data');
    expect(result).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });
});
