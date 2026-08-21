import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { consumeDownloadStream, fetchAndConsumeGarbage, runDownloadTest } from './download.ts';

describe('consumeDownloadStream()', () => {
  it('reads chunks until done', async (): Promise<void> => {
    let call = 0;
    const reader = {
      cancel: vi.fn().mockResolvedValue(undefined),
      read: vi.fn().mockImplementation(async () => {
        call++;
        if (call === 1) return { done: false, value: new Uint8Array(100) };
        return { done: true, value: undefined };
      }),
    } as unknown as ReadableStreamDefaultReader<Uint8Array>;

    const chunks: number[] = [];
    await consumeDownloadStream(reader, (bytes) => {
      chunks.push(bytes);
      return true;
    });

    expect(chunks).toEqual([100]);
    expect(reader.cancel).toHaveBeenCalled();
  });

  it('stops reading when onChunk returns false', async (): Promise<void> => {
    const reader = {
      cancel: vi.fn().mockResolvedValue(undefined),
      read: vi.fn().mockResolvedValue({ done: false, value: new Uint8Array(50) }),
    } as unknown as ReadableStreamDefaultReader<Uint8Array>;

    const chunks: number[] = [];
    await consumeDownloadStream(reader, (bytes) => {
      chunks.push(bytes);
      return false;
    });

    expect(chunks).toEqual([50]);
    expect(reader.cancel).toHaveBeenCalled();
  });
});

describe('fetchAndConsumeGarbage()', () => {
  it('throws error if response has no body', async (): Promise<void> => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null)));
    const abort = new AbortController();

    await expect(
      fetchAndConsumeGarbage('http://localhost', 10, 5, () => true, abort.signal),
    ).rejects.toThrow('ReadableStream not supported');
  });
});

describe('runDownloadTest()', () => {
  let postMessageMock: Mock;

  beforeEach((): void => {
    postMessageMock = vi.fn();
    vi.stubGlobal('self', { postMessage: postMessageMock });
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('runs download test and reports progress and done for cumulative calcMethod', async (): Promise<void> => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(1048576));
        controller.close();
      },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        body: stream,
        ok: true,
      }),
    );

    await runDownloadTest('http://localhost', 1, 1, 2, 'cumulative');

    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'dl_done',
      }),
    );
  });

  it('runs download test with peak calcMethod and reports progress', async (): Promise<void> => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(524288));
        controller.close();
      },
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        body: stream,
        ok: true,
      }),
    );

    await runDownloadTest('http://localhost', 1, 1, 1, 'peak');

    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'dl_done',
      }),
    );
  });

  it('handles thread errors and sends dl_error when threshold is exceeded', async (): Promise<void> => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Fetch failed')));

    await runDownloadTest('http://localhost', 1, 5, 1, 'cumulative');

    expect(postMessageMock).toHaveBeenCalledWith({
      type: 'dl_error',
      value: 'Error',
    });
  });

  it('covers catch block when already inactive and reporter with hasError', async (): Promise<void> => {
    vi.useFakeTimers();
    let rejectStream: () => void = (): void => {};
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(
          async (
            _url: string,
            options?: { signal?: AbortSignal },
          ): Promise<{ body: { getReader: () => unknown }; ok: boolean }> => {
            return {
              body: {
                getReader: (): unknown => ({
                  cancel: vi.fn().mockResolvedValue(undefined),
                  read: (): Promise<never> =>
                    new Promise((_, reject) => {
                      rejectStream = (): void => reject(new Error('Aborted stream'));
                      options?.signal?.addEventListener('abort', () =>
                        reject(new Error('AbortSignal')),
                      );
                    }),
                }),
              },
              ok: true,
            };
          },
        ),
    );

    const testPromise = runDownloadTest('http://localhost', 1, 1, 2, 'cumulative');
    await vi.advanceTimersByTimeAsync(1100);
    rejectStream();
    await testPromise;
    expect(postMessageMock).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('covers reporter tick after thread failure has set hasError', async (): Promise<void> => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        call++;
        if (call === 2) {
          await new Promise((resolve) => setTimeout(resolve, 2400));
          return {
            body: {
              getReader: (): unknown => ({
                cancel: vi.fn().mockResolvedValue(undefined),
                read: vi.fn().mockResolvedValue({ done: true, value: undefined }),
              }),
            },
            ok: true,
          };
        }
        throw new Error('Worker 0 failure');
      }),
    );

    await runDownloadTest('http://localhost', 1, 5, 2, 'cumulative');
    expect(postMessageMock).toHaveBeenCalledWith({
      type: 'dl_error',
      value: 'Error',
    });
  });
});
