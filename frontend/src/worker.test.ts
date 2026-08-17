import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import './worker.ts';

describe('SpeedyBenchWorker', () => {
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
          this.upload.onprogress({ loaded: Number.MAX_SAFE_INTEGER } as ProgressEvent);
        }
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 0);
      });
    };
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
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.endsWith('/api/empty')) {
        performanceNowValue += 10;
        return { ok: true };
      }
      if (urlStr.includes('/api/garbage')) {
        return {
          body: {
            getReader: () => {
              return {
                cancel: vi.fn().mockResolvedValue(undefined),
                read: async () => {
                  if (bytesRead > 1024 * 1024) {
                    return { done: true, value: undefined };
                  }
                  bytesRead += 1024 * 256;
                  performanceNowValue += 100;
                  return new Promise((resolve) => {
                    setTimeout(
                      () => resolve({ done: false, value: new Uint8Array(1024 * 256) }),
                      5,
                    );
                  });
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

    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const onmessage = window.onmessage as ((e: MessageEvent) => Promise<void>) | null;
    await onmessage?.({
      data: { base: 'http://127.0.0.1/', debug: true, type: 'start' },
    } as MessageEvent);

    expect(postMessageMock).toHaveBeenCalledWith({ type: 'status', value: 'pinging' });
    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'ping' }));
    expect(postMessageMock).toHaveBeenCalledWith({ type: 'status', value: 'downloading' });
    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'dl_done' }));
    expect(postMessageMock).toHaveBeenCalledWith({ type: 'status', value: 'uploading' });
    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'ul_done' }));
    expect(postMessageMock).toHaveBeenCalledWith({ type: 'status', value: 'done' });
    expect(debugSpy).toHaveBeenCalledWith(
      '[speedybench]',
      'sending download result',
      expect.objectContaining({ chartSamples: expect.any(Array), samples: expect.any(Array) }),
    );
  });

  it('handles fetch errors during ping gracefully', async (): Promise<void> => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = vi.fn().mockImplementation(() => Promise.reject(new Error('Network error')));

    const onmessage = window.onmessage as ((e: MessageEvent) => Promise<void>) | null;
    await onmessage?.({ data: { base: 'http://127.0.0.1/', type: 'start' } } as MessageEvent);

    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'status' }));
    errorSpy.mockRestore();
  });

  it('handles fetch errors during download gracefully', async (): Promise<void> => {
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(async (url) => {
      performanceNowValue += 5000;
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/api/garbage')) {
        callCount++;
        if (callCount === 1) {
          throw new Error('Download failed');
        } else {
          return new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                body: {
                  getReader: () => ({
                    cancel: vi.fn().mockResolvedValue(undefined),
                    read: async () => ({ done: true }),
                  }),
                },
                ok: true,
              });
            }, 10);
          });
        }
      }
      return { ok: true };
    });

    const onmessage = window.onmessage as ((e: MessageEvent) => Promise<void>) | null;
    await onmessage?.({
      data: { base: 'http://127.0.0.1/', threads: 2, type: 'start' },
    } as MessageEvent);

    expect(postMessageMock).toHaveBeenCalledWith({ type: 'dl_error', value: 'Error' });
  });

  it('updates chartSamples every 250 ms independently of samples', async (): Promise<void> => {
    let bytesRead = 0;
    global.fetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.endsWith('/api/empty')) {
        performanceNowValue += 250;
        return { ok: true };
      }
      if (urlStr.includes('/api/garbage')) {
        return {
          body: {
            getReader: () => ({
              cancel: vi.fn().mockResolvedValue(undefined),
              read: async () => {
                if (bytesRead > 8 * 1024 * 1024) {
                  return { done: true, value: undefined };
                }
                bytesRead += 1024 * 256;
                performanceNowValue += 250;
                return new Promise((resolve) => {
                  setTimeout(() => resolve({ done: false, value: new Uint8Array(1024 * 256) }), 5);
                });
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
          this.upload.onprogress({ loaded: 1024 * 256 } as ProgressEvent);
        }
        performanceNowValue += 250;
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 0);
      });
    };

    const onmessage = window.onmessage as ((e: MessageEvent) => Promise<void>) | null;
    await onmessage?.({
      data: { base: 'http://127.0.0.1/', sizeMB: 10, threads: 1, timeoutSec: 10, type: 'start' },
    } as MessageEvent);

    let lastChartLen = 0;
    let lastSamplesLen = 0;
    let chartGrowCount = 0;
    let samplesGrowCount = 0;

    for (const call of postMessageMock.mock.calls) {
      const data = call[0] as { type?: string; chartSamples?: unknown[]; samples?: unknown[] };
      if (data.type !== 'dl_progress' && data.type !== 'ul_progress') continue;
      const chartLen = data.chartSamples?.length ?? 0;
      const samplesLen = data.samples?.length ?? 0;
      if (chartLen > lastChartLen) chartGrowCount++;
      if (samplesLen > lastSamplesLen) samplesGrowCount++;
      lastChartLen = chartLen;
      lastSamplesLen = samplesLen;
    }

    expect(chartGrowCount).toBeGreaterThan(samplesGrowCount);
    expect(samplesGrowCount).toBeGreaterThan(0);
  });

  it('handles fetch errors during upload gracefully', async (): Promise<void> => {
    global.fetch = vi.fn().mockImplementation(async (url, options) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.endsWith('/api/empty') && options?.method === 'POST') {
        throw new Error('Upload failed');
      }
      return {
        body: {
          getReader: () => ({
            cancel: vi.fn().mockResolvedValue(undefined),
            read: async () => ({ done: true }),
          }),
        },
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
    await onmessage?.({ data: { base: 'http://127.0.0.1/', type: 'start' } } as MessageEvent);

    expect(postMessageMock).toHaveBeenCalledWith({ type: 'ul_error', value: 'Error' });
  });

  it('cancels download if it takes more than 10 seconds', async (): Promise<void> => {
    let cancelCalled = false;
    global.fetch = vi.fn().mockImplementation(async (url, options) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.endsWith('/api/empty') && options?.method === 'POST') {
        performanceNowValue += 11000;
        return { ok: true };
      }
      if (urlStr.endsWith('/api/empty')) {
        return { ok: true };
      }
      if (urlStr.includes('/api/garbage')) {
        return {
          body: {
            getReader: () => ({
              cancel: async () => {
                cancelCalled = true;
                throw new Error('cancel failed');
              },
              read: async () => {
                performanceNowValue += 11000;
                return new Promise((resolve) => {
                  setTimeout(() => resolve({ done: false, value: new Uint8Array(10) }), 5);
                });
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
    await onmessage?.({ data: { base: 'http://127.0.0.1/', type: 'start' } } as MessageEvent);

    expect(cancelCalled).toBe(true);
  });

  it('throws error if response body is null (ReadableStream not supported)', async (): Promise<void> => {
    global.fetch = vi.fn().mockImplementation(async (url) => {
      performanceNowValue += 11000;
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/api/garbage')) {
        return { body: null, ok: true };
      }
      return { ok: true };
    });

    const onmessage = window.onmessage as ((e: MessageEvent) => Promise<void>) | null;
    await onmessage?.({ data: { base: 'http://127.0.0.1/', type: 'start' } } as MessageEvent);

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
    await onmessage?.({ data: { base: 'http://127.0.0.1/', type: 'start' } } as MessageEvent);

    Object.defineProperty(global, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'ul_done' }));
  });

  it('cancels download and upload if maxBytes is reached', async (): Promise<void> => {
    let abortCalled = false;
    global.fetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/api/garbage')) {
        return {
          body: {
            getReader: () => ({
              cancel: vi.fn().mockResolvedValue(undefined),
              read: async () => ({ done: false, value: new Uint8Array(2 * 1024 * 1024) }),
            }),
          },
          ok: true,
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
        abortCalled = true;
        if (this.onabort) this.onabort();
      });
      send = vi.fn().mockImplementation(function (this: MockXHR) {
        if (this.upload.onprogress) {
          this.upload.onprogress({ loaded: 2 * 1024 * 1024 } as ProgressEvent);
        }
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 0);
      });
    };

    const onmessage = window.onmessage as ((e: MessageEvent) => Promise<void>) | null;
    await onmessage?.({
      data: { base: 'http://127.0.0.1/', sizeMB: 1, threads: 1, timeoutSec: 15, type: 'start' },
    } as MessageEvent);

    expect(abortCalled).toBe(true);
  });

  it('cancels upload if it takes more than timeout limit', async (): Promise<void> => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
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
        performanceNowValue += 11000;
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 0);
      });
    };

    const onmessage = window.onmessage as ((e: MessageEvent) => Promise<void>) | null;
    await onmessage?.({
      data: { base: 'http://127.0.0.1/', sizeMB: 100, threads: 1, timeoutSec: 10, type: 'start' },
    } as MessageEvent);

    await new Promise((r) => setTimeout(r, 20));

    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'ul_done' }));
  });
  it('handles peak calcMethod with less than 4 samples', async (): Promise<void> => {
    let readCount = 0;
    global.fetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/api/garbage')) {
        return {
          body: {
            getReader: () => ({
              cancel: async () => {},
              read: async () => {
                readCount++;
                if (readCount > 1) return { done: true, value: undefined };
                return { done: false, value: new Uint8Array(10 * 1024 * 1024) };
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
      abort = vi.fn();
      send = vi.fn().mockImplementation(function (this: MockXHR) {
        if (this.upload.onprogress) {
          this.upload.onprogress({ loaded: 10 * 1024 * 1024 } as ProgressEvent);
        }
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 0);
      });
    };

    const onmessage = window.onmessage as ((e: MessageEvent) => Promise<void>) | null;
    await onmessage?.({
      data: {
        base: 'http://127.0.0.1/',
        calcMethod: 'peak',
        sizeMB: 1,
        threads: 1,
        timeoutSec: 10,
        type: 'start',
      },
    } as MessageEvent);

    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'dl_done' }));
    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'ul_done' }));
  });

  it('adds final sample if currentTime > 50 in download', async (): Promise<void> => {
    global.fetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/api/garbage')) {
        return {
          body: {
            getReader: () => ({
              cancel: async () => {},
              read: async () => {
                performanceNowValue += 51;
                return { done: true, value: undefined };
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
      abort = vi.fn();
      send = vi.fn().mockImplementation(function (this: MockXHR) {
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 0);
      });
    };

    const onmessage = window.onmessage as ((e: MessageEvent) => Promise<void>) | null;
    await onmessage?.({
      data: {
        base: 'http://127.0.0.1/',
        calcMethod: 'cumulative',
        sizeMB: 1,
        threads: 1,
        timeoutSec: 10,
        type: 'start',
      },
    } as MessageEvent);

    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'dl_done' }));
  });

  it('handles peak calcMethod with 4 or more samples', async (): Promise<void> => {
    let dlCallCount = 0;
    global.fetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = typeof url === 'string' ? url : url.toString();
      if (urlStr.includes('/api/garbage')) {
        return {
          body: {
            getReader: () => ({
              cancel: async () => {},
              read: async () => {
                dlCallCount++;
                if (dlCallCount <= 5) {
                  performanceNowValue += 300;
                  return new Promise((resolve) => {
                    setTimeout(() => resolve({ done: false, value: new Uint8Array(10) }), 260);
                  });
                }
                performanceNowValue += 60;
                return { done: true, value: undefined };
              },
            }),
          },
        };
      }
      return { ok: true };
    });

    let ulCallCount = 0;
    (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = class MockXHR {
      upload = { onprogress: null as ((e: ProgressEvent) => void) | null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open = vi.fn();
      abort = vi.fn();
      send = vi.fn().mockImplementation(function (this: MockXHR) {
        ulCallCount++;
        if (ulCallCount <= 5) {
          performanceNowValue += 300;
        }
        if (this.upload.onprogress) {
          this.upload.onprogress({ loaded: 1 * 1024 * 1024 } as ProgressEvent);
        }
        setTimeout(() => {
          if (ulCallCount <= 5) {
            this.send();
          } else if (this.onload) {
            this.onload();
          }
        }, 260);
      });
    };

    const onmessage = window.onmessage as ((e: MessageEvent) => Promise<void>) | null;
    await onmessage?.({
      data: {
        base: 'http://127.0.0.1/',
        calcMethod: 'peak',
        sizeMB: 1,
        threads: 1,
        timeoutSec: 10,
        type: 'start',
      },
    } as MessageEvent);

    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'dl_done' }));
    expect(postMessageMock).toHaveBeenCalledWith(expect.objectContaining({ type: 'ul_done' }));
  });
});
