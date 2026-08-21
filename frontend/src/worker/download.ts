import { debugLog } from '../debug.ts';
import { calculateMbps, calculateMbpsNum } from '../utils.ts';
import { calculatePeakSustained, calculateWindowMbps, type IntervalSample } from './calc.ts';
import { createLoadedPingTracker } from './ping.ts';

export interface Sample {
  bytes: number;
  speed: number;
  timeMs: number;
}

export const consumeDownloadStream = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onChunk: (bytes: number) => boolean,
): Promise<void> => {
  let reading = true;
  while (reading) {
    const { done, value } = await reader.read();
    if (done || !value) {
      reading = false;
      break;
    }
    const shouldContinue = onChunk(value.length);
    if (!shouldContinue) {
      reading = false;
      break;
    }
  }
  reader.cancel().catch(() => {});
};

export const fetchAndConsumeGarbage = async (
  base: string,
  sizeMB: number,
  timeoutSec: number,
  onChunk: (bytes: number) => boolean,
  signal: AbortSignal,
): Promise<void> => {
  const response = await fetch(new URL(`./api/garbage?size=${sizeMB}&time=${timeoutSec}`, base), {
    cache: 'no-store',
    signal,
  });
  if (!response.body) throw new Error('ReadableStream not supported');
  const reader = response.body.getReader();
  await consumeDownloadStream(reader, onChunk);
};

export const runDownloadTest = async (
  base: string,
  sizeMB: number,
  timeoutSec: number,
  threads: number,
  calcMethod: 'cumulative' | 'peak',
): Promise<void> => {
  const start = performance.now();
  let totalBytes = 0;
  const timeoutMs = timeoutSec * 1000;
  const maxBytes = sizeMB * 1024 * 1024;
  let active = true;
  let hasError = false;
  let failedThreads = 0;
  const failThreshold = Math.ceil(threads * 0.5);
  const samples: Sample[] = [];
  const chartSamples: Sample[] = [];
  const recentIntervals: IntervalSample[] = [];
  let lastBytes = 0;
  let lastTime = start;
  const pingTracker = createLoadedPingTracker(base);
  const abortController = new AbortController();

  const handleDownloadChunk = (chunkBytes: number): boolean => {
    totalBytes += chunkBytes;
    if (totalBytes >= maxBytes) {
      active = false;
      return false;
    }
    return active;
  };

  const handleDownloadThreadFailure = (): void => {
    failedThreads++;
    if (failedThreads >= failThreshold && active) {
      active = false;
      hasError = true;
      self.postMessage({ type: 'dl_error', value: 'Error' });
    }
  };

  const downloadWorker = async (index: number): Promise<void> => {
    if (index > 0) {
      await new Promise((resolve) => setTimeout(resolve, index * 100));
    }
    let retries = 0;
    while (active) {
      try {
        await fetchAndConsumeGarbage(
          base,
          sizeMB,
          timeoutSec,
          handleDownloadChunk,
          abortController.signal,
        );
        break;
      } catch {
        if (!active) break;
        retries++;
        if (retries > 3) {
          handleDownloadThreadFailure();
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  };

  const workers = Array.from({ length: threads }, (_, i) => downloadWorker(i));

  let lastSampleBytes = 0;
  let lastSampleTime = start;

  const reporter = setInterval(() => {
    if (hasError) return;
    const now = performance.now();
    const timeSinceStart = now - start;
    const currentBytes = totalBytes - lastBytes;
    const currentTime = now - lastTime;

    recentIntervals.push({ bytes: currentBytes, durationMs: currentTime });

    let uiMbps = 0;
    if (calcMethod === 'peak') {
      uiMbps = calculateWindowMbps(recentIntervals, 2000);
    } else {
      uiMbps = calculateWindowMbps(recentIntervals, 1000);
    }

    chartSamples.push({ bytes: totalBytes, speed: uiMbps, timeMs: timeSinceStart });

    const timeSinceLastSample = now - lastSampleTime;
    if (timeSinceLastSample >= 1000) {
      const sampleBytes = totalBytes - lastSampleBytes;
      const sampleMbps = calculateMbpsNum(sampleBytes, timeSinceLastSample);
      samples.push({ bytes: totalBytes, speed: sampleMbps, timeMs: timeSinceStart });
      lastSampleBytes = totalBytes;
      lastSampleTime = now;
    }

    lastBytes = totalBytes;
    lastTime = now;

    const displayValue = uiMbps.toFixed(2);
    const progressChartSamples = [...chartSamples];
    const progressSamples = [...samples];

    debugLog('sending download progress', {
      chartSamples: progressChartSamples,
      samples: progressSamples,
    });
    self.postMessage({
      bytes: totalBytes,
      chartSamples: progressChartSamples,
      loadedPing: pingTracker.getPing(),
      samples: progressSamples,
      timeMs: timeSinceStart,
      type: 'dl_progress',
      value: displayValue,
    });
    if (timeSinceStart >= timeoutMs || totalBytes >= maxBytes) {
      active = false;
      abortController.abort();
      clearInterval(reporter);
    }
  }, 250);

  setTimeout(() => {
    active = false;
    abortController.abort();
  }, timeoutMs);

  await Promise.all(workers);
  clearInterval(reporter);
  const finalLoadedPing = pingTracker.stop();

  if (!hasError) {
    const finalNow = performance.now();
    const currentBytes = totalBytes - lastBytes;
    const currentTime = finalNow - lastTime;
    if (currentTime > 50 && currentBytes > 0) {
      samples.push({
        bytes: totalBytes,
        speed: calculateMbpsNum(currentBytes, currentTime),
        timeMs: finalNow - start,
      });
    }

    let displayValue: string;
    if (calcMethod === 'peak') {
      displayValue = calculatePeakSustained(samples.map((s) => s.speed));
    } else {
      displayValue = calculateMbps(totalBytes, finalNow - start);
    }

    const doneChartSamples = [...chartSamples];
    const doneSamples = [...samples];

    debugLog('sending download result', { chartSamples: doneChartSamples, samples: doneSamples });
    self.postMessage({
      bytes: totalBytes,
      chartSamples: doneChartSamples,
      loadedPing: finalLoadedPing,
      samples: doneSamples,
      timeMs: finalNow - start,
      type: 'dl_done',
      value: displayValue,
    });
  }
};
