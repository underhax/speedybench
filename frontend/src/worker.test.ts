import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import './worker.ts';

describe('SpeedyBench Worker', () => {
  let originalFetch: typeof fetch;
  let originalXMLHttpRequest: typeof XMLHttpRequest | undefined;
  let originalSetTimeout: typeof setTimeout;
  let originalSetInterval: typeof setInterval;
  let postMessageMock: Mock;
  let performanceNowValue = 0;

  beforeEach((): void => {
    originalFetch = global.fetch;
    originalXMLHttpRequest = (global as unknown as { XMLHttpRequest?: typeof XMLHttpRequest })
      .XMLHttpRequest;
    originalSetTimeout = global.setTimeout;
    global.setTimeout = ((cb: (...args: unknown[]) => void, ms?: number) => {
      if (ms === 10000) {
        return originalSetTimeout(cb, 10);
      }
      return originalSetTimeout(cb, ms);
    }) as unknown as typeof setTimeout;
    originalSetInterval = global.setInterval;
    global.setInterval = ((cb: (...args: unknown[]) => void, ms?: number) => {
      if (ms === 250) {
        return originalSetInterval(cb, 2);
      }
      return originalSetInterval(cb, ms);
    }) as unknown as typeof setInterval;
    postMessageMock = vi.fn();
    vi.stubGlobal('postMessage', postMessageMock);
    vi.resetModules();
    performanceNowValue = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => performanceNowValue);
  });

  afterEach((): void => {
    global.fetch = originalFetch;
    if (originalXMLHttpRequest) {
      (global as unknown as { XMLHttpRequest: typeof XMLHttpRequest }).XMLHttpRequest =
        originalXMLHttpRequest;
    } else {
      delete (global as unknown as { XMLHttpRequest?: typeof XMLHttpRequest }).XMLHttpRequest;
    }
    global.setTimeout = originalSetTimeout;
    global.setInterval = originalSetInterval;
    vi.restoreAllMocks();
  });

  it('runs the full test suite when receiving start message', async (): Promise<void> => {
    let _fetchCallCount = 0;
    let bytesRead = 0;

    global.fetch = vi.fn().mockImplementation(async (url) => {
      _fetchCallCount++;
      if (url === '/api/empty') {
        performanceNowValue += 10;
        return { ok: true };
      }
      if (url.startsWith('/api/garbage')) {
        return {
          body: {
            getReader: () => {
              return {
                cancel: vi.fn(),
                read: async () => {
                  if (bytesRead > 1024 * 1024) {
                    return { done: true, value: undefined };
                  }
                  bytesRead += 1024;
                  performanceNowValue += 5;
                  return { done: false, value: new Uint8Array(1024) };
                },
              };
            },
          },
        };
      }
      return { ok: true };
    });

    (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = class MockXHR {
      upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open = vi.fn();
      abort = vi.fn().mockImplementation(function (this: MockXHR) {
        if (this.onabort) this.onabort();
      });
      send = vi.fn().mockImplementation(function (this: MockXHR) {
        if (this.upload.onprogress) {
          this.upload.onprogress({ loaded: 1024 } as ProgressEvent);
          setTimeout(() => {
            if (this.upload.onprogress) this.upload.onprogress({ loaded: 2048 } as ProgressEvent);
          }, 15);
        }
        performanceNowValue += 10;
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 0);
      });
    };

    const onmessage = window.onmessage as ((e: MessageEvent) => Promise<void>) | null;
    await onmessage?.({ data: 'start' } as MessageEvent);

    expect(postMessageMock).toHaveBeenCalledWith({ type: 'status', value: 'pinging' });
    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'ping' }));
    expect(postMessageMock).toHaveBeenCalledWith({ type: 'status', value: 'downloading' });
    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'dl_done' }));
    expect(postMessageMock).toHaveBeenCalledWith({ type: 'status', value: 'uploading' });
    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'ul_done' }));
    expect(postMessageMock).toHaveBeenCalledWith({ type: 'status', value: 'done' });
  });

  it('handles fetch errors during ping gracefully', async (): Promise<void> => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = vi.fn().mockImplementation(() => Promise.reject(new Error('Network error')));

    const onmessage = window.onmessage as ((e: MessageEvent) => Promise<void>) | null;
    await onmessage?.({ data: 'start' } as MessageEvent);

    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'status' }));
    errorSpy.mockRestore();
  });

  it('handles fetch errors during download gracefully', async (): Promise<void> => {
    global.fetch = vi.fn().mockImplementation(async (url) => {
      performanceNowValue += 5000;
      if (url.startsWith('/api/garbage')) {
        throw new Error('Download failed');
      }
      return { ok: true };
    });

    const onmessage = window.onmessage as ((e: MessageEvent) => Promise<void>) | null;
    await onmessage?.({ data: 'start' } as MessageEvent);

    expect(postMessageMock).toHaveBeenCalledWith({ type: 'dl_error', value: 'Error' });
  });

  it('handles fetch errors during upload gracefully', async (): Promise<void> => {
    global.fetch = vi.fn().mockImplementation(async (url, options) => {
      if (url === '/api/empty' && options?.method === 'POST') {
        throw new Error('Upload failed');
      }
      return {
        body: { getReader: () => ({ cancel: vi.fn(), read: async () => ({ done: true }) }) },
        ok: true,
      };
    });

    (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = class MockXHR {
      upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open = vi.fn();
      abort = vi.fn().mockImplementation(function (this: MockXHR) {
        if (this.onabort) this.onabort();
      });
      send = vi.fn().mockImplementation(function (this: MockXHR) {
        if (this.upload.onprogress) {
          this.upload.onprogress({ loaded: 1024 } as ProgressEvent);
        }
        setTimeout(() => {
          if (this.onerror) this.onerror();
        }, 0);
      });
    };

    const onmessage = window.onmessage as ((e: MessageEvent) => Promise<void>) | null;
    await onmessage?.({ data: 'start' } as MessageEvent);

    expect(postMessageMock).toHaveBeenCalledWith({ type: 'ul_error', value: 'Error' });
  });

  it('cancels download if it takes more than 10 seconds', async (): Promise<void> => {
    let cancelCalled = false;
    global.fetch = vi.fn().mockImplementation(async (url, options) => {
      if (url === '/api/empty' && options?.method === 'POST') {
        performanceNowValue += 11000;
        return { ok: true };
      }
      if (url === '/api/empty') {
        return { ok: true };
      }
      if (url.startsWith('/api/garbage')) {
        return {
          body: {
            getReader: () => ({
              cancel: () => {
                cancelCalled = true;
              },
              read: async () => {
                performanceNowValue += 11000;
                return { done: false, value: new Uint8Array(10) };
              },
            }),
          },
        };
      }
      return { ok: true };
    });

    (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = class MockXHR {
      upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open = vi.fn();
      abort = vi.fn().mockImplementation(function (this: MockXHR) {
        if (this.onabort) this.onabort();
      });
      send = vi.fn().mockImplementation(function (this: MockXHR) {
        if (this.upload.onprogress) {
          this.upload.onprogress({ loaded: 1024 } as ProgressEvent);
          setTimeout(() => {
            if (this.upload.onprogress) this.upload.onprogress({ loaded: 2048 } as ProgressEvent);
          }, 15);
        }
        performanceNowValue += 11000;
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 0);
      });
    };

    const onmessage = window.onmessage as ((e: MessageEvent) => Promise<void>) | null;
    await onmessage?.({ data: 'start' } as MessageEvent);

    expect(cancelCalled).toBe(true);
  });

  it('throws error if response body is null (ReadableStream not supported)', async (): Promise<void> => {
    global.fetch = vi.fn().mockImplementation(async (url) => {
      performanceNowValue += 11000;
      if (url.startsWith('/api/garbage')) {
        return { body: null, ok: true };
      }
      return { ok: true };
    });

    const onmessage = window.onmessage as ((e: MessageEvent) => Promise<void>) | null;
    await onmessage?.({ data: 'start' } as MessageEvent);

    expect(postMessageMock).toHaveBeenCalledWith({ type: 'dl_error', value: 'Error' });
  });

  it('ignores messages other than "start"', async (): Promise<void> => {
    const onmessage = window.onmessage as ((e: MessageEvent) => Promise<void>) | null;
    await onmessage?.({ data: 'unknown_command' } as MessageEvent);

    expect(postMessageMock).not.toHaveBeenCalled();
  });

  it('uses fallback concurrency when hardwareConcurrency is undefined', async (): Promise<void> => {
    const originalNavigator = global.navigator;
    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: { ...originalNavigator, hardwareConcurrency: undefined },
    });

    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = class MockXHR {
      upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open = vi.fn();
      abort = vi.fn();
      send = vi.fn().mockImplementation(function (this: MockXHR) {
        performanceNowValue += 11000;
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 0);
      });
    };

    const onmessage = window.onmessage as ((e: MessageEvent) => Promise<void>) | null;
    await onmessage?.({ data: 'start' } as MessageEvent);

    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'ul_done' }));
  });
});
