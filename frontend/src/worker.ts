import { calculateMbps } from './utils.ts';

const runPingTest = async (): Promise<void> => {
  let minPing = Infinity;
  let maxPing = 0;
  let totalPing = 0;
  const pings = [];

  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    try {
      await fetch('/api/empty', { cache: 'no-store' });
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

const runDownloadTest = async (): Promise<void> => {
  const start = performance.now();
  let totalBytes = 0;

  try {
    const response = await fetch('/api/garbage?ckSize=100', { cache: 'no-store' });
    if (!response.body) throw new Error('ReadableStream not supported');

    const reader = response.body.getReader();
    let lastReport = start;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.length;
      const now = performance.now();

      if (now - lastReport > 250) {
        self.postMessage({ type: 'dl_progress', value: calculateMbps(totalBytes, now - start) });
        lastReport = now;
      }

      if (now - start > 10000) {
        reader.cancel();
        break;
      }
    }
    const finalNow = performance.now();
    self.postMessage({ type: 'dl_done', value: calculateMbps(totalBytes, finalNow - start) });
  } catch (_e) {
    self.postMessage({ type: 'dl_error', value: 'Error' });
  }
};

const runUploadTest = async (): Promise<void> => {
  const start = performance.now();
  let totalBytes = 0;

  const chunk = new Uint8Array(10 * 1024 * 1024);
  for (let i = 0; i < chunk.length; i += 65536) {
    crypto.getRandomValues(chunk.subarray(i, i + 65536));
  }

  let active = true;

  const sendChunk = async (): Promise<void> => {
    return new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/empty');

      let lastLoaded = 0;
      xhr.upload.onprogress = (event: ProgressEvent): void => {
        if (!active) {
          xhr.abort();
          return;
        }
        const loadedDiff = event.loaded - lastLoaded;
        totalBytes += loadedDiff;
        lastLoaded = event.loaded;
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

      xhr.send(chunk);
    });
  };

  const uploadWorker = async (): Promise<void> => {
    while (active) {
      await sendChunk();
    }
  };

  const concurrency = navigator.hardwareConcurrency || 4;
  const workers = Array.from({ length: concurrency }, () => uploadWorker());

  const reporter = setInterval(() => {
    const now = performance.now();
    self.postMessage({ type: 'ul_progress', value: calculateMbps(totalBytes, now - start) });
    if (now - start >= 10000) {
      active = false;
      clearInterval(reporter);
    }
  }, 250);

  await new Promise((resolve) => setTimeout(resolve, 10000));
  active = false;
  clearInterval(reporter);
  await Promise.all(workers);

  const finalNow = performance.now();
  self.postMessage({ type: 'ul_done', value: calculateMbps(totalBytes, finalNow - start) });
};

self.onmessage = async (e: MessageEvent): Promise<void> => {
  if (e.data === 'start') {
    self.postMessage({ type: 'status', value: 'pinging' });
    await runPingTest();

    self.postMessage({ type: 'status', value: 'downloading' });
    await runDownloadTest();

    self.postMessage({ type: 'status', value: 'uploading' });
    await runUploadTest();

    self.postMessage({ type: 'status', value: 'done' });
  }
};
