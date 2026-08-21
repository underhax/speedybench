export interface PingResult {
  avgPing: string;
  jitter: string;
  maxPing: string;
  minPing: string;
  type: 'ping';
  value: string;
}

export interface LoadedPingTracker {
  getPing: () => string;
  stop: () => string;
}

export async function runPingTest(base: string): Promise<PingResult> {
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
    } catch {}
  }

  const avgPing = pings.length > 0 ? totalPing / pings.length : 0;
  let jitterSum = 0;
  for (const p of pings) {
    jitterSum += Math.abs(p - avgPing);
  }
  const jitter = pings.length > 0 ? jitterSum / pings.length : 0;
  const finalMin = Number.isFinite(minPing) ? minPing : 0;

  const result: PingResult = {
    avgPing: avgPing.toFixed(1),
    jitter: jitter.toFixed(1),
    maxPing: maxPing.toFixed(1),
    minPing: finalMin.toFixed(1),
    type: 'ping',
    value: finalMin.toFixed(1),
  };

  self.postMessage(result);
  return result;
}

export function createLoadedPingTracker(base: string): LoadedPingTracker {
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
      } catch {}
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
}
