import { debugLog } from '../debug.ts';
import { calculateMbps, calculateMbpsNum } from '../utils.ts';
import { calculatePeakSustained, calculateWindowMbps, type IntervalSample } from './calc.ts';
import { createLoadedPingTracker } from './ping.ts';

export interface Sample {
  bytes: number;
  speed: number;
  timeMs: number;
}

export type UploadTier = 1 | 4 | 16;

export function adaptTier(tier: UploadTier, durationMs: number, bytesSent: number): UploadTier {
  const mbps = calculateMbpsNum(bytesSent, durationMs);
  if (tier === 16) return mbps < 80 ? 4 : 16;
  if (tier === 4) {
    if (mbps > 100) return 16;
    if (mbps < 20) return 1;
    return 4;
  }
  return mbps > 30 ? 4 : 1;
}

export function createUploadBlobs(): {
  blob1MB: Blob;
  blob4MB: Blob;
  blob16MB: Blob;
} {
  const baseChunk = new Uint8Array(1024 * 1024);
  for (let i = 0; i < baseChunk.length; i += 65536) {
    crypto.getRandomValues(baseChunk.subarray(i, i + 65536));
  }

  const blob1MB = new Blob([baseChunk]);
  const blob4MB = new Blob([baseChunk, baseChunk, baseChunk, baseChunk]);
  const chunks16: Uint8Array[] = [];
  for (let i = 0; i < 16; i++) {
    chunks16.push(baseChunk);
  }
  const blob16MB = new Blob(chunks16 as BlobPart[]);

  return { blob1MB, blob4MB, blob16MB };
}

export const runUploadTest = async (
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

  const { blob1MB, blob4MB, blob16MB } = createUploadBlobs();

  const payloadForTier = (tier: UploadTier): Blob => {
    if (tier === 1) return blob1MB;
    if (tier === 4) return blob4MB;
    return blob16MB;
  };

  const sendChunk = async (
    payload: Blob,
    signal: AbortSignal,
  ): Promise<{ durationMs: number; success: boolean }> => {
    return new Promise<{ durationMs: number; success: boolean }>((resolve) => {
      const sendStart = performance.now();
      const xhr = new XMLHttpRequest();
      xhr.open('POST', new URL(`./api/empty?time=${timeoutSec}`, base).toString());

      let lastLoaded = 0;
      xhr.upload.onprogress = (event: ProgressEvent): void => {
        if (!active) {
          xhr.abort();
          return;
        }
        const loadedDiff = event.loaded - lastLoaded;
        if (loadedDiff <= 0 || !Number.isFinite(loadedDiff)) {
          return;
        }
        totalBytes += loadedDiff;
        lastLoaded = event.loaded;

        if (totalBytes >= maxBytes) {
          active = false;
          xhr.abort();
        }
      };

      xhr.onload = (): void =>
        resolve({ durationMs: performance.now() - sendStart, success: true });
      xhr.onerror = (): void =>
        resolve({ durationMs: performance.now() - sendStart, success: false });
      xhr.onabort = (): void =>
        resolve({ durationMs: performance.now() - sendStart, success: true });

      signal.addEventListener('abort', () => xhr.abort(), { once: true });

      xhr.send(payload);
    });
  };

  const handleUploadThreadFailure = (): void => {
    failedThreads++;
    if (failedThreads >= failThreshold && active) {
      active = false;
      hasError = true;
      self.postMessage({ type: 'ul_error', value: 'Error' });
    }
  };

  const handleUploadFailure = async (retries: number): Promise<number> => {
    if (!active) return retries;
    const nextRetries = retries + 1;
    if (nextRetries > 3) {
      handleUploadThreadFailure();
      return nextRetries;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    return nextRetries;
  };

  const uploadWorker = async (index: number): Promise<void> => {
    if (index > 0) {
      await new Promise((resolve) => setTimeout(resolve, index * 100));
    }
    let retries = 0;
    let currentTier: UploadTier = 1;
    let isColdStart = true;
    while (active) {
      const payload = payloadForTier(currentTier);
      const { durationMs, success } = await sendChunk(payload, abortController.signal);
      if (!success) {
        retries = await handleUploadFailure(retries);
        continue;
      }
      retries = 0;
      if (isColdStart) {
        isColdStart = false;
        continue;
      }
      currentTier = adaptTier(currentTier, durationMs, payload.size);
    }
  };

  const workers = Array.from({ length: threads }, (_, i) => uploadWorker(i));

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

    debugLog('sending upload progress', {
      chartSamples: progressChartSamples,
      samples: progressSamples,
    });
    self.postMessage({
      bytes: totalBytes,
      chartSamples: progressChartSamples,
      loadedPing: pingTracker.getPing(),
      samples: progressSamples,
      timeMs: timeSinceStart,
      type: 'ul_progress',
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

    debugLog('sending upload result', { chartSamples: doneChartSamples, samples: doneSamples });
    self.postMessage({
      bytes: totalBytes,
      chartSamples: doneChartSamples,
      loadedPing: finalLoadedPing,
      samples: doneSamples,
      timeMs: finalNow - start,
      type: 'ul_done',
      value: displayValue,
    });
  }
};
