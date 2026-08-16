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
  const samples: { speed: number; bytes: number; timeMs: number }[] = [];
  const chartSamples: { speed: number; bytes: number; timeMs: number }[] = [];
  let lastBytes = 0;
  let lastTime = start;

  const downloadWorker = async (): Promise<void> => {
    try {
      const response = await fetch(
        new URL(`./api/garbage?size=${sizeMB}&time=${timeoutSec}`, base),
        {
          cache: 'no-store',
        },
      );
      if (!response.body) throw new Error('ReadableStream not supported');

      const reader = response.body.getReader();

      while (active) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        totalBytes += value.length;

        if (totalBytes >= maxBytes) {
          active = false;
        }
      }
      reader.cancel().catch(() => {});
    } catch (_e) {
      if (active) {
        active = false;
        hasError = true;
        self.postMessage({ type: 'dl_error', value: 'Error' });
      }
    }
  };

  const workers = Array.from({ length: threads }, () => downloadWorker());

  let lastSampleBytes = 0;
  let lastSampleTime = start;

  const reporter = setInterval(() => {
    if (hasError) return;
    const now = performance.now();
    const timeSinceStart = now - start;
    const currentBytes = totalBytes - lastBytes;
    const currentTime = now - lastTime;

    let uiMbps = 0;
    if (timeSinceStart < 1500) {
      uiMbps = calculateMbpsNum(totalBytes, timeSinceStart);
    } else {
      uiMbps = calculateMbpsNum(currentBytes, currentTime);
    }

    if (totalBytes > 0) {
      chartSamples.push({ bytes: totalBytes, speed: uiMbps, timeMs: timeSinceStart });
    }

    const timeSinceLastSample = now - lastSampleTime;
    if (totalBytes > 0 && timeSinceLastSample >= 1000) {
      const sampleBytes = totalBytes - lastSampleBytes;
      const sampleMbps = calculateMbpsNum(sampleBytes, timeSinceLastSample);
      samples.push({ bytes: totalBytes, speed: sampleMbps, timeMs: timeSinceStart });
      lastSampleBytes = totalBytes;
      lastSampleTime = now;
    }

    lastBytes = totalBytes;
    lastTime = now;

    const displayValue = uiMbps.toFixed(2);

    self.postMessage({
      bytes: totalBytes,
      chartSamples: [...chartSamples],
      samples: [...samples],
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

    self.postMessage({
      bytes: totalBytes,
      chartSamples: [...chartSamples],
      samples: [...samples],
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
  const samples: { speed: number; bytes: number; timeMs: number }[] = [];
  const chartSamples: { speed: number; bytes: number; timeMs: number }[] = [];
  let lastBytes = 0;
  let lastTime = start;

  const baseChunk = new Uint8Array(1024 * 1024);
  for (let i = 0; i < baseChunk.length; i += 65536) {
    crypto.getRandomValues(baseChunk.subarray(i, i + 65536));
  }

  const bytesPerThread = Math.min(25 * 1024 * 1024, Math.ceil(maxBytes / threads));
  const numChunks = Math.ceil(bytesPerThread / baseChunk.length);
  const chunksArray: Uint8Array[] = [];
  for (let i = 0; i < numChunks; i++) {
    chunksArray.push(baseChunk);
  }
  const payload = new Blob(chunksArray as BlobPart[]);

  let active = true;

  const sendChunk = async (): Promise<void> => {
    return new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', new URL(`./api/empty?time=${timeoutSec}`, base).toString());

      let lastLoaded = 0;
      xhr.upload.onprogress = (event: ProgressEvent): void => {
        if (!active) {
          xhr.abort();
          return;
        }
        const loadedDiff = event.loaded - lastLoaded;
        totalBytes += loadedDiff;
        lastLoaded = event.loaded;

        if (totalBytes >= maxBytes) {
          active = false;
          xhr.abort();
        }
      };

      xhr.onload = (): void => resolve();
      xhr.onerror = (): void => {
        if (active) {
          active = false;
          self.postMessage({ type: 'ul_error', value: 'Error' });
        }
        resolve();
      };
      xhr.onabort = (): void => resolve();

      xhr.send(payload);
    });
  };

  const uploadWorker = async (): Promise<void> => {
    while (active) {
      await sendChunk();
    }
  };

  const workers = Array.from({ length: threads }, () => uploadWorker());

  let lastSampleBytes = 0;
  let lastSampleTime = start;

  const reporter = setInterval(() => {
    const now = performance.now();
    const timeSinceStart = now - start;
    const currentBytes = totalBytes - lastBytes;
    const currentTime = now - lastTime;

    let uiMbps = 0;
    if (timeSinceStart < 1500) {
      uiMbps = calculateMbpsNum(totalBytes, timeSinceStart);
    } else {
      uiMbps = calculateMbpsNum(currentBytes, currentTime);
    }

    if (totalBytes > 0) {
      chartSamples.push({ bytes: totalBytes, speed: uiMbps, timeMs: timeSinceStart });
    }

    const timeSinceLastSample = now - lastSampleTime;
    if (totalBytes > 0 && timeSinceLastSample >= 1000) {
      const sampleBytes = totalBytes - lastSampleBytes;
      const sampleMbps = calculateMbpsNum(sampleBytes, timeSinceLastSample);
      samples.push({ bytes: totalBytes, speed: sampleMbps, timeMs: timeSinceStart });
      lastSampleBytes = totalBytes;
      lastSampleTime = now;
    }

    lastBytes = totalBytes;
    lastTime = now;

    const displayValue = uiMbps.toFixed(2);

    self.postMessage({
      bytes: totalBytes,
      chartSamples: [...chartSamples],
      samples: [...samples],
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

  self.postMessage({
    bytes: totalBytes,
    chartSamples: [...chartSamples],
    samples: [...samples],
    timeMs: finalNow - start,
    type: 'ul_done',
    value: displayValue,
  });
};

self.onmessage = async (e: MessageEvent): Promise<void> => {
  if (e.data?.type === 'start') {
    const { base, sizeMB = 100, timeoutSec = 15, threads = 4, calcMethod = 'cumulative' } = e.data;
    self.postMessage({ type: 'status', value: 'pinging' });
    await runPingTest(base);

    self.postMessage({ type: 'status', value: 'downloading' });
    await runDownloadTest(base, sizeMB, timeoutSec, threads, calcMethod);

    self.postMessage({ type: 'status', value: 'uploading' });
    await runUploadTest(base, sizeMB, timeoutSec, threads, calcMethod);

    self.postMessage({ type: 'status', value: 'done' });
  }
};
