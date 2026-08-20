import { debugLog, setDebugEnabled } from './debug.ts';
import { calculateMbps, calculateMbpsNum } from './utils.ts';

const calculatePeakSustained = (samples: number[]): string => {
  if (samples.length < 4) {
    const sum = samples.reduce((a, b) => a + b, 0);
    return (samples.length > 0 ? sum / samples.length : 0).toFixed(2);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const dropBottom = Math.floor(sorted.length * 0.3);
  const dropTop = Math.floor(sorted.length * 0.1);
  const valid = sorted.slice(dropBottom, sorted.length - dropTop);
  const sum = valid.reduce((a, b) => a + b, 0);
  return (sum / valid.length).toFixed(2);
};

const runPingTest = async (base: string): Promise<void> => {
  let minPing = Infinity;
  let maxPing = 0;
  let totalPing = 0;
  const pings = [];

  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    try {
      await fetch(new URL('./api/empty', base), { cache: 'no-store', method: 'HEAD' });
      const duration = performance.now() - start;
      pings.push(duration);
      if (duration < minPing) minPing = duration;
      if (duration > maxPing) maxPing = duration;
      totalPing += duration;
    } catch (_e) {}
  }

  const avgPing = pings.length > 0 ? totalPing / pings.length : 0;
  let jitterSum = 0;
  for (const p of pings) {
    jitterSum += Math.abs(p - avgPing);
  }
  const jitter = pings.length > 0 ? jitterSum / pings.length : 0;

  self.postMessage({ jitter: jitter.toFixed(1), type: 'ping', value: minPing.toFixed(1) });
};

const calculateWindowMbps = (
  intervals: { bytes: number; durationMs: number }[],
  windowMs = 2000,
): number => {
  let totalWindowBytes = 0;
  let totalWindowDuration = 0;
  for (let i: number = intervals.length - 1; i >= 0; i--) {
    const item = intervals[i];
    if (!item) continue;
    totalWindowBytes += item.bytes;
    totalWindowDuration += item.durationMs;
    if (totalWindowDuration >= windowMs) break;
  }
  return calculateMbpsNum(totalWindowBytes, totalWindowDuration);
};

const consumeDownloadStream = async (
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

const fetchAndConsumeGarbage = async (
  base: string,
  sizeMB: number,
  timeoutSec: number,
  onChunk: (bytes: number) => boolean,
): Promise<void> => {
  const response = await fetch(new URL(`./api/garbage?size=${sizeMB}&time=${timeoutSec}`, base), {
    cache: 'no-store',
  });
  if (!response.body) throw new Error('ReadableStream not supported');
  const reader = response.body.getReader();
  await consumeDownloadStream(reader, onChunk);
};

const createLoadedPingTracker = (base: string): { getPing: () => string; stop: () => string } => {
  let totalPing = 0;
  let pingCount = 0;
  let running = true;

  const loop = async (): Promise<void> => {
    while (running) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      if (!running) break;
      const start = performance.now();
      try {
        await fetch(new URL('./api/empty', base), { cache: 'no-store', method: 'HEAD' });
        const duration = performance.now() - start;
        totalPing += duration;
        pingCount++;
      } catch (_e) {}
    }
  };

  void loop();

  const currentResult = (): string => (pingCount > 0 ? (totalPing / pingCount).toFixed(1) : '');

  return {
    getPing: currentResult,
    stop: (): string => {
      running = false;
      return currentResult();
    },
  };
};

const runDownloadTest = async (
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
  const samples: { speed: number; bytes: number; timeMs: number }[] = [];
  const chartSamples: { speed: number; bytes: number; timeMs: number }[] = [];
  const recentIntervals: { bytes: number; durationMs: number }[] = [];
  let lastBytes = 0;
  let lastTime = start;
  const pingTracker = createLoadedPingTracker(base);

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
        await fetchAndConsumeGarbage(base, sizeMB, timeoutSec, handleDownloadChunk);
        break;
      } catch (_e) {
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
      uiMbps = calculateMbpsNum(currentBytes, currentTime);
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
      clearInterval(reporter);
    }
  }, 250);

  setTimeout(() => {
    active = false;
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

const runUploadTest = async (
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
  const samples: { speed: number; bytes: number; timeMs: number }[] = [];
  const chartSamples: { speed: number; bytes: number; timeMs: number }[] = [];
  const recentIntervals: { bytes: number; durationMs: number }[] = [];
  let lastBytes = 0;
  let lastTime = start;
  const pingTracker = createLoadedPingTracker(base);

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

  type UploadTier = 1 | 4 | 16;
  const nextTier = (tier: UploadTier): UploadTier => (tier === 1 ? 4 : 16);
  const prevTier = (tier: UploadTier): UploadTier => (tier === 16 ? 4 : 1);
  const adaptTier = (tier: UploadTier, durationMs: number): UploadTier => {
    if (durationMs < 150) return nextTier(tier);
    if (durationMs > 600) return prevTier(tier);
    return tier;
  };

  const sendChunk = async (payload: Blob): Promise<{ durationMs: number; success: boolean }> => {
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

  const payloadForTier = (tier: UploadTier): Blob => {
    if (tier === 1) return blob1MB;
    if (tier === 4) return blob4MB;
    return blob16MB;
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
    while (active) {
      const { durationMs, success } = await sendChunk(payloadForTier(currentTier));
      if (!success) {
        retries = await handleUploadFailure(retries);
        continue;
      }
      retries = 0;
      currentTier = adaptTier(currentTier, durationMs);
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
      uiMbps = calculateMbpsNum(currentBytes, currentTime);
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
      clearInterval(reporter);
    }
  }, 250);

  setTimeout(() => {
    active = false;
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

self.onmessage = async (e: MessageEvent): Promise<void> => {
  if (e.data?.type === 'start') {
    const {
      base,
      calcMethod = 'peak',
      debug = false,
      sizeMB = 200,
      threads = 4,
      timeoutSec = 15,
    } = e.data;
    setDebugEnabled(debug === true);
    self.postMessage({ type: 'status', value: 'pinging' });
    await runPingTest(base);

    self.postMessage({ type: 'status', value: 'downloading' });
    await runDownloadTest(base, sizeMB, timeoutSec, threads, calcMethod);

    self.postMessage({ type: 'status', value: 'uploading' });
    await runUploadTest(base, sizeMB, timeoutSec, threads, calcMethod);

    self.postMessage({ type: 'status', value: 'done' });
  }
};
