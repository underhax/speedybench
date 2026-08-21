import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { adaptTier, createUploadBlobs, runUploadTest } from './upload.ts';

describe('adaptTier()', () => {
  it('adapts tier 16 correctly based on speed', (): void => {
    expect(adaptTier(16, 1000, 10 * 1024 * 1024)).toBe(16);
    expect(adaptTier(16, 1000, 5 * 1024 * 1024)).toBe(4);
  });

  it('adapts tier 4 correctly based on speed', (): void => {
    expect(adaptTier(4, 1000, 20 * 1024 * 1024)).toBe(16);
    expect(adaptTier(4, 1000, 1 * 1024 * 1024)).toBe(1);
    expect(adaptTier(4, 1000, 5 * 1024 * 1024)).toBe(4);
  });

  it('adapts tier 1 correctly based on speed', (): void => {
    expect(adaptTier(1, 1000, 10 * 1024 * 1024)).toBe(4);
    expect(adaptTier(1, 1000, 1 * 1024 * 1024)).toBe(1);
  });
});

describe('createUploadBlobs()', () => {
  it('creates binary upload blobs with expected sizes', (): void => {
    const { blob1MB, blob4MB, blob16MB } = createUploadBlobs();
    expect(blob1MB.size).toBe(1024 * 1024);
    expect(blob4MB.size).toBe(4 * 1024 * 1024);
    expect(blob16MB.size).toBe(16 * 1024 * 1024);
  });
});

describe('runUploadTest()', () => {
  let postMessageMock: Mock;
  let originalXhr: typeof XMLHttpRequest;

  beforeEach((): void => {
    postMessageMock = vi.fn();
    vi.stubGlobal('self', { postMessage: postMessageMock });
    originalXhr = globalThis.XMLHttpRequest;
  });

  afterEach((): void => {
    globalThis.XMLHttpRequest = originalXhr;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('runs upload test with progress reporting and cumulative result', async (): Promise<void> => {
    class MockXHR {
      upload = {
        onprogress: null as ((e: { loaded: number }) => void) | null,
      };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open = vi.fn();
      abort = vi.fn();
      send = vi.fn().mockImplementation(() => {
        setTimeout((): void => {
          this.upload.onprogress?.({ loaded: 1048576 });
          this.onload?.();
        }, 10);
      });
    }

    globalThis.XMLHttpRequest = MockXHR as unknown as typeof XMLHttpRequest;

    await runUploadTest('http://localhost', 1, 1, 2, 'cumulative');

    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ul_done',
      }),
    );
  });

  it('runs upload test with peak calcMethod and adapts tiers', async (): Promise<void> => {
    class MockXHR {
      upload = {
        onprogress: null as ((e: { loaded: number }) => void) | null,
      };
      onload: (() => void) | null = null;
      open = vi.fn();
      abort = vi.fn();
      send = vi.fn().mockImplementation(() => {
        setTimeout((): void => {
          this.upload.onprogress?.({ loaded: 1048576 });
          this.upload.onprogress?.({ loaded: 1048576 });
          this.onload?.();
        }, 5);
      });
    }

    globalThis.XMLHttpRequest = MockXHR as unknown as typeof XMLHttpRequest;

    await runUploadTest('http://localhost', 1, 1, 1, 'peak');

    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ul_done',
      }),
    );
  });

  it('handles XHR errors and sends ul_error when thread fails', async (): Promise<void> => {
    class FailingXHR {
      upload = { onprogress: null };
      onerror: (() => void) | null = null;
      open = vi.fn();
      abort = vi.fn();
      send = vi.fn().mockImplementation(() => {
        setTimeout((): void => {
          this.onerror?.();
        }, 5);
      });
    }

    globalThis.XMLHttpRequest = FailingXHR as unknown as typeof XMLHttpRequest;

    await runUploadTest('http://localhost', 1, 5, 1, 'cumulative');

    expect(postMessageMock).toHaveBeenCalledWith({
      type: 'ul_error',
      value: 'Error',
    });
  });

  it('handles XHR abort events and reporter tick after error', async (): Promise<void> => {
    let call = 0;
    class DelayedXHR {
      upload = { onprogress: null };
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open = vi.fn();
      abort = vi.fn();
      send = vi.fn().mockImplementation(() => {
        call++;
        if (call === 2) {
          setTimeout((): void => {
            this.onabort?.();
          }, 2400);
          return;
        }
        setTimeout((): void => {
          this.onerror?.();
        }, 5);
      });
    }

    globalThis.XMLHttpRequest = DelayedXHR as unknown as typeof XMLHttpRequest;

    await runUploadTest('http://localhost', 1, 5, 2, 'cumulative');

    expect(postMessageMock).toHaveBeenCalledWith({
      type: 'ul_error',
      value: 'Error',
    });
  });

  it('handles upload failure when already inactive', async (): Promise<void> => {
    const callbackHolder: { trigger: (() => void) | null } = { trigger: null };

    class InactiveXHR {
      upload = { onprogress: null };
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open = vi.fn();
      abort = vi.fn().mockImplementation(() => {
        this.onabort?.();
      });
      send = vi.fn().mockImplementation(() => {
        if (!callbackHolder.trigger) {
          callbackHolder.trigger = (): void => {
            this.onerror?.();
          };
          return;
        }
        setTimeout((): void => {
          this.onerror?.();
        }, 5);
      });
    }

    globalThis.XMLHttpRequest = InactiveXHR as unknown as typeof XMLHttpRequest;

    const testPromise = runUploadTest('http://localhost', 1, 5, 2, 'cumulative');

    await new Promise((resolve) => setTimeout(resolve, 2200));
    callbackHolder.trigger?.();
    await testPromise;

    expect(postMessageMock).toHaveBeenCalledWith({
      type: 'ul_error',
      value: 'Error',
    });
  });
});
