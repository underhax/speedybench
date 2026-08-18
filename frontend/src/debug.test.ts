import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('loadDebugConfig()', () => {
  beforeEach((): void => {
    vi.resetModules();
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('enables debug logging from a valid configuration', async (): Promise<void> => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ debug: true }),
        ok: true,
      }),
    );
    const { debugLog, getDebugEnabled, loadDebugConfig } = await import('./debug.ts');

    await loadDebugConfig();
    debugLog('test message');

    expect(getDebugEnabled()).toBe(true);
    expect(debugSpy).toHaveBeenCalledWith('[speedybench]', 'test message');
  });

  it('disables debug logging for an invalid configuration with wrong type', async (): Promise<void> => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ debug: 'true' }),
        ok: true,
      }),
    );
    const { debugLog, getDebugEnabled, loadDebugConfig, setDebugEnabled } = await import(
      './debug.ts'
    );
    setDebugEnabled(true);

    await loadDebugConfig();
    debugLog('test message');

    expect(getDebugEnabled()).toBe(false);
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it('disables debug logging when json payload is not a valid object', async (): Promise<void> => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue(null),
        ok: true,
      }),
    );
    const { getDebugEnabled, loadDebugConfig, setDebugEnabled } = await import('./debug.ts');
    setDebugEnabled(true);

    await loadDebugConfig();

    expect(getDebugEnabled()).toBe(false);
  });

  it('disables debug logging when server returns non-ok status', async (): Promise<void> => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ debug: true }),
        ok: false,
      }),
    );
    const { getDebugEnabled, loadDebugConfig, setDebugEnabled } = await import('./debug.ts');
    setDebugEnabled(true);

    await loadDebugConfig();

    expect(getDebugEnabled()).toBe(false);
  });

  it('disables debug logging when configuration loading fails', async (): Promise<void> => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const { getDebugEnabled, loadDebugConfig, setDebugEnabled } = await import('./debug.ts');
    setDebugEnabled(true);

    await loadDebugConfig();

    expect(getDebugEnabled()).toBe(false);
  });
});

describe('debugLog()', () => {
  beforeEach((): void => {
    vi.resetModules();
  });

  afterEach((): void => {
    vi.restoreAllMocks();
  });

  it('suppresses logging when debug mode is disabled', async (): Promise<void> => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { debugLog, setDebugEnabled } = await import('./debug.ts');
    setDebugEnabled(false);

    debugLog('suppressed message');

    expect(debugSpy).not.toHaveBeenCalled();
  });
});
