import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { createLoadedPingTracker, runPingTest } from './ping.ts';

describe('runPingTest()', () => {
  let fetchMock: Mock;
  let postMessageMock: Mock;

  beforeEach((): void => {
    fetchMock = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal('fetch', fetchMock);
    postMessageMock = vi.fn();
    vi.stubGlobal('self', { postMessage: postMessageMock });
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('measures 10 pings and calculates statistics', async (): Promise<void> => {
    let callCount = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      callCount++;
      return callCount * 10;
    });

    const result = await runPingTest('http://localhost');
    expect(result.type).toBe('ping');
    expect(Number.parseFloat(result.minPing)).toBeGreaterThanOrEqual(0);
    expect(Number.parseFloat(result.avgPing)).toBeGreaterThanOrEqual(0);
    expect(Number.parseFloat(result.maxPing)).toBeGreaterThanOrEqual(0);
    expect(Number.parseFloat(result.jitter)).toBeGreaterThanOrEqual(0);
    expect(postMessageMock).toHaveBeenCalledWith(result);
  });

  it('handles all fetch failures gracefully', async (): Promise<void> => {
    fetchMock.mockRejectedValue(new Error('Network failure'));
    const result = await runPingTest('http://localhost');
    expect(result.minPing).toBe('0.0');
    expect(result.avgPing).toBe('0.0');
    expect(result.maxPing).toBe('0.0');
    expect(result.jitter).toBe('0.0');
    expect(postMessageMock).toHaveBeenCalledWith(result);
  });
});

describe('createLoadedPingTracker()', () => {
  let fetchMock: Mock;

  beforeEach((): void => {
    vi.useFakeTimers();
    fetchMock = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach((): void => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('tracks latency under load and returns formatted ping', async (): Promise<void> => {
    const tracker = createLoadedPingTracker('http://localhost');
    expect(tracker.getPing()).toBe('');

    await vi.advanceTimersByTimeAsync(850);
    expect(fetchMock).toHaveBeenCalled();

    const currentPing = tracker.getPing();
    expect(currentPing).not.toBe('');

    const finalPing = tracker.stop();
    expect(finalPing).toBe(currentPing);

    await vi.advanceTimersByTimeAsync(1600);
  });

  it('handles fetch errors in loaded ping loop gracefully', async (): Promise<void> => {
    fetchMock.mockRejectedValue(new Error('Fetch failed'));
    const tracker = createLoadedPingTracker('http://localhost');

    await vi.advanceTimersByTimeAsync(850);
    expect(tracker.getPing()).toBe('');
    tracker.stop();
  });
});
