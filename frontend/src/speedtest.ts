import { drawAreaChart } from './chart.ts';
import { debugLog, getDebugEnabled, loadDebugConfig } from './debug.ts';
import { applyTranslations, localize } from './localize.ts';
import { currentSettings } from './settings.ts';
import {
  formatDeltaPing,
  formatIdlePingStats,
  setupChartTooltip,
  setupStatTooltip,
} from './tooltip.ts';
import type { DetailsData, SampleObj } from './ui/details.ts';

export function formatBytes(bytes: number): string {
  if (bytes === 0) return `0.0 ${localize('unit_mb')}`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} ${localize('unit_mb')}`;
}

export function formatTime(ms: number): string {
  return `${(ms / 1000).toFixed(1)} ${localize('settings_sec')}`;
}

export function updateMetric(
  textId: string,
  subTextId: string,
  value: string,
  bytes?: number,
  timeMs?: number,
): void {
  const el = document.querySelector(textId);
  if (el) el.textContent = value;
  const subEl = document.querySelector(subTextId);
  if (subEl && bytes !== undefined && timeMs !== undefined) {
    subEl.textContent = `${formatBytes(bytes)} / ${formatTime(timeMs)}`;
  }
}

export interface SpeedtestController {
  getDlDetails: () => DetailsData;
  getUlDetails: () => DetailsData;
  stopTest: () => void;
}

export function setupSpeedtest(): SpeedtestController {
  const debugConfigPromise = loadDebugConfig();

  let dlSamples: SampleObj[] = [];
  let ulSamples: SampleObj[] = [];
  let dlChartSamples: SampleObj[] = [];
  let ulChartSamples: SampleObj[] = [];
  let dlFinalVal = '';
  let ulFinalVal = '';
  let idlePingMin = '';
  let idlePingAvg = '';
  let idlePingMax = '';
  let idlePingVal = '';
  let dlPingVal = '';
  let ulPingVal = '';

  const dlChartEl = document.querySelector('#dlChart') as SVGSVGElement;
  const dlTestArea = dlChartEl?.closest('.testArea') as HTMLElement | null;
  if (dlTestArea && dlChartEl) {
    setupChartTooltip(dlTestArea, dlChartEl, () => dlChartSamples, '--dl-color');
  }

  const ulChartEl = document.querySelector('#ulChart') as SVGSVGElement;
  const ulTestArea = ulChartEl?.closest('.testArea') as HTMLElement | null;
  if (ulTestArea && ulChartEl) {
    setupChartTooltip(ulTestArea, ulChartEl, () => ulChartSamples, '--ul-color');
  }

  const statPingEl = document.querySelector('#stat-ping') as HTMLElement | null;
  if (statPingEl) {
    setupStatTooltip(statPingEl, () => ({
      extra: formatIdlePingStats(idlePingMin, idlePingAvg, idlePingMax),
      title: localize('idle_ping'),
    }));
  }

  const statDlPingEl = document.querySelector('#stat-dl-ping') as HTMLElement | null;
  if (statDlPingEl) {
    setupStatTooltip(statDlPingEl, () => ({
      extra: formatDeltaPing(dlPingVal, idlePingVal),
      title: localize('dl_ping'),
    }));
  }

  const statUlPingEl = document.querySelector('#stat-ul-ping') as HTMLElement | null;
  if (statUlPingEl) {
    setupStatTooltip(statUlPingEl, () => ({
      extra: formatDeltaPing(ulPingVal, idlePingVal),
      title: localize('ul_ping'),
    }));
  }

  const statJitterEl = document.querySelector('#stat-jitter') as HTMLElement | null;
  if (statJitterEl) {
    setupStatTooltip(statJitterEl, () => ({
      title: localize('jitter'),
    }));
  }

  const startBtn = document.querySelector('#startStopBtn') as HTMLDivElement;
  let worker: Worker | null = null;
  let isRunning = false;

  const initUI = (): void => {
    const ids = ['dlText', 'ulText', 'pingText', 'dlPingText', 'ulPingText', 'jitText', 'ip'];
    ids.forEach((id) => {
      const el = document.querySelector(`#${id}`);
      if (el) el.textContent = '';
    });
    const charts = ['dlChart', 'ulChart'];
    charts.forEach((id) => {
      const el = document.querySelector(`#${id}`);
      if (el) el.innerHTML = '';
    });
    const subIds = ['dlSubText', 'ulSubText'];
    subIds.forEach((id) => {
      const el = document.querySelector(`#${id}`);
      if (el) el.textContent = '';
    });
    document.querySelector('#dl-info-btn')?.classList.add('hidden');
    document.querySelector('#ul-info-btn')?.classList.add('hidden');
    dlSamples = [];
    ulSamples = [];
    dlChartSamples = [];
    ulChartSamples = [];
    dlFinalVal = '';
    ulFinalVal = '';
    idlePingMin = '';
    idlePingAvg = '';
    idlePingMax = '';
    idlePingVal = '';
    dlPingVal = '';
    ulPingVal = '';
    startBtn?.classList.remove('done');
  };

  const stopTest = (): void => {
    worker?.terminate();
    worker = null;
    isRunning = false;
    startBtn?.classList.remove('running');
    startBtn?.classList.remove('done');
    applyTranslations();
    initUI();
  };

  const handlePing = (
    value: string,
    jitter: string,
    minPing?: string,
    avgPing?: string,
    maxPing?: string,
  ): void => {
    idlePingVal = value;
    idlePingMin = minPing ?? value;
    idlePingAvg = avgPing ?? '';
    idlePingMax = maxPing ?? '';
    const el = document.querySelector('#pingText');
    if (el) el.textContent = value;
    const jel = document.querySelector('#jitText');
    if (jel) jel.textContent = jitter;
  };

  const handleDlProgress = (
    value: string,
    bytes: number,
    timeMs: number,
    samples?: SampleObj[],
    chartSamples?: SampleObj[],
    loadedPing?: string,
  ): void => {
    updateMetric('#dlText', '#dlSubText', value, bytes, timeMs);
    if (loadedPing) {
      dlPingVal = loadedPing;
      const el = document.querySelector('#dlPingText');
      if (el) el.textContent = loadedPing;
    }
    const chartEl = document.querySelector('#dlChart');
    const drawSamples = chartSamples ?? samples;
    if (chartEl && drawSamples) {
      debugLog('drawing download chart', { chartSamples, samples });
      chartEl.innerHTML = drawAreaChart(
        drawSamples.map((s) => s.speed),
        '--dl-color',
      );
    }
  };

  const handleDlDone = (
    value: string,
    bytes: number,
    timeMs: number,
    samples?: SampleObj[],
    chartSamples?: SampleObj[],
    loadedPing?: string,
  ): void => {
    handleDlProgress(value, bytes, timeMs, samples, chartSamples, loadedPing);
    if (chartSamples) dlChartSamples = chartSamples;
    if (samples) {
      dlSamples = samples;
      dlFinalVal = value;
      document.querySelector('#dl-info-btn')?.classList.remove('hidden');
    }
  };

  const handleUlProgress = (
    value: string,
    bytes: number,
    timeMs: number,
    samples?: SampleObj[],
    chartSamples?: SampleObj[],
    loadedPing?: string,
  ): void => {
    updateMetric('#ulText', '#ulSubText', value, bytes, timeMs);
    if (loadedPing) {
      ulPingVal = loadedPing;
      const el = document.querySelector('#ulPingText');
      if (el) el.textContent = loadedPing;
    }
    const chartEl = document.querySelector('#ulChart');
    const drawSamples = chartSamples ?? samples;
    if (chartEl && drawSamples) {
      debugLog('drawing upload chart', { chartSamples, samples });
      chartEl.innerHTML = drawAreaChart(
        drawSamples.map((s) => s.speed),
        '--ul-color',
      );
    }
  };

  const handleUlDone = (
    value: string,
    bytes: number,
    timeMs: number,
    samples?: SampleObj[],
    chartSamples?: SampleObj[],
    loadedPing?: string,
  ): void => {
    handleUlProgress(value, bytes, timeMs, samples, chartSamples, loadedPing);
    if (chartSamples) ulChartSamples = chartSamples;
    if (samples) {
      ulSamples = samples;
      ulFinalVal = value;
      document.querySelector('#ul-info-btn')?.classList.remove('hidden');
    }
  };

  const handleWorkerMessage = (e: MessageEvent): void => {
    const {
      type,
      value,
      jitter,
      minPing,
      avgPing,
      maxPing,
      samples,
      chartSamples,
      bytes,
      timeMs,
      loadedPing,
    } = e.data;
    debugLog('received worker message', { chartSamples, samples, type });
    switch (type) {
      case 'ping':
        handlePing(value, jitter, minPing, avgPing, maxPing);
        break;
      case 'dl_progress':
        handleDlProgress(value, bytes, timeMs, samples, chartSamples, loadedPing);
        break;
      case 'dl_done':
        handleDlDone(value, bytes, timeMs, samples, chartSamples, loadedPing);
        break;
      case 'ul_progress':
        handleUlProgress(value, bytes, timeMs, samples, chartSamples, loadedPing);
        break;
      case 'ul_done':
        handleUlDone(value, bytes, timeMs, samples, chartSamples, loadedPing);
        break;
      case 'status': {
        if (value === 'done') {
          isRunning = false;
          startBtn?.classList.remove('running');
          startBtn?.classList.add('done');
          applyTranslations();
          worker?.terminate();
          worker = null;
        }
        break;
      }
    }
  };

  startBtn?.addEventListener('click', async (): Promise<void> => {
    if (isRunning) {
      stopTest();
      return;
    }

    isRunning = true;
    startBtn.classList.remove('done');
    startBtn.classList.add('running');
    applyTranslations();
    initUI();

    await debugConfigPromise;
    if (!isRunning) return;

    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = handleWorkerMessage;
    worker.postMessage({
      base: window.location.href,
      calcMethod: currentSettings.calcMethod,
      debug: getDebugEnabled(),
      sizeMB: currentSettings.size,
      threads: currentSettings.threads,
      timeoutSec: currentSettings.time,
      type: 'start',
    });

    fetch(new URL('./api/ip', window.location.href))
      .then((res: Response): Promise<string> => res.text())
      .then((ip: string): void => {
        const ipText = document.querySelector('#ip');
        if (ipText) ipText.textContent = ip;
      })
      .catch(() => {});
  });

  return {
    getDlDetails: () => ({ finalSpeed: dlFinalVal, samples: dlSamples }),
    getUlDetails: () => ({ finalSpeed: ulFinalVal, samples: ulSamples }),
    stopTest,
  };
}
