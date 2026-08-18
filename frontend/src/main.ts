import './style.css';
import { drawAreaChart } from './chart.ts';
import { debugLog, getDebugEnabled, loadDebugConfig } from './debug.ts';
import {
  applyTranslations,
  availableLanguages,
  getCurrentLanguage,
  initLanguage,
  localize,
  setLanguage,
} from './localize.ts';
import { initTheme, toggleTheme } from './theme.ts';
import { setupChartTooltip } from './tooltip.ts';

const svgs = import.meta.glob('./icons/*.svg', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

function formatBytes(bytes: number): string {
  if (bytes === 0) return `0.0 ${localize('unit_mb')}`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} ${localize('unit_mb')}`;
}

function formatTime(ms: number): string {
  return `${(ms / 1000).toFixed(1)} ${localize('settings_sec')}`;
}

function updateMetric(
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

function injectIcons(): void {
  const setIcon = (id: string, name: string): void => {
    const el = document.querySelector(`#${id}`);
    if (el) el.innerHTML = svgs[`./icons/${name}.svg`] as string;
  };

  setIcon('download-icon', 'download');
  setIcon('upload-icon', 'upload');
  setIcon('ping-icon', 'ping');
  setIcon('dl-ping-icon', 'down-ping');
  setIcon('ul-ping-icon', 'up-ping');
  setIcon('jitter-icon', 'jitter');
  setIcon('ip-icon', 'ip');
  setIcon('lang-icon', 'language');
  setIcon('logo-icon', 'logo');
  setIcon('settings-toggle', 'settings');
  setIcon('dl-info-icon', 'info');
  setIcon('ul-info-icon', 'info');
}

function updateThemeIcon(): void {
  const isLight = document.documentElement.classList.contains('theme-light');
  const btn = document.querySelector('#theme-toggle');
  if (btn) btn.innerHTML = svgs[`./icons/theme-${isLight ? 'dark' : 'light'}.svg`] as string;
}

function setupLangSelector(): void {
  const dropdown = document.querySelector('#lang-dropdown') as HTMLDivElement;
  const selectedBtn = document.querySelector('#lang-selected') as HTMLDivElement;
  const currentLangText = document.querySelector('#current-lang-text') as HTMLSpanElement;
  const optionsList = document.querySelector('#lang-options') as HTMLUListElement;

  if (!dropdown || !selectedBtn || !currentLangText || !optionsList) return;

  const currentLang = getCurrentLanguage();
  currentLangText.textContent = currentLang.toUpperCase();

  availableLanguages.forEach((lang) => {
    const li = document.createElement('li');
    li.textContent = lang.code.toUpperCase();
    if (lang.code === currentLang) {
      li.classList.add('active');
    }
    li.addEventListener('click', () => {
      setLanguage(lang.code);
      currentLangText.textContent = lang.code.toUpperCase();
      dropdown.classList.remove('open');
      optionsList.querySelectorAll('li').forEach((el) => {
        el.classList.remove('active');
      });
      li.classList.add('active');
    });
    optionsList.appendChild(li);
  });

  selectedBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  document.addEventListener('click', () => {
    dropdown.classList.remove('open');
  });
}

interface Settings {
  size: number;
  time: number;
  threads: number;
  calcMethod: 'cumulative' | 'peak';
  save: boolean;
}

const defaultSettings: Settings = {
  calcMethod: 'cumulative',
  save: false,
  size: 200,
  threads: 4,
  time: 15,
};

let serverThreads = 4;

export function initServerInfo(): Promise<void> {
  return fetch('./api/cpu')
    .then((res) => res.text())
    .then((text) => {
      const cpus = Number.parseInt(text, 10);
      if (!Number.isNaN(cpus) && cpus > 0) {
        serverThreads = cpus <= 4 ? 4 : 6;
        if (currentSettings.threads > 1) {
          currentSettings.threads = serverThreads;
        }
      }
    })
    .catch(Object);
}

void initServerInfo();

let currentSettings: Settings = { ...defaultSettings };

function loadSettings(): void {
  const local = localStorage.getItem('speedybench_settings');
  if (local) {
    try {
      currentSettings = { ...defaultSettings, ...JSON.parse(local), save: true };
      return;
    } catch {}
  }

  const session = sessionStorage.getItem('speedybench_settings');
  if (session) {
    try {
      currentSettings = { ...defaultSettings, ...JSON.parse(session), save: false };
    } catch {}
  }
}

function saveSettings(): void {
  const json = JSON.stringify(currentSettings);
  if (currentSettings.save) {
    localStorage.setItem('speedybench_settings', json);
    sessionStorage.removeItem('speedybench_settings');
  } else {
    sessionStorage.setItem('speedybench_settings', json);
    localStorage.removeItem('speedybench_settings');
  }
}

export function updateSliderGradient(slider: HTMLInputElement): void {
  const min = Number.parseFloat(slider.min) || 0;
  const max = Number.parseFloat(slider.max) || 100;
  const val = Number.parseFloat(slider.value) || 0;
  const percent = max > min ? ((val - min) / (max - min)) * 100 : 0;
  slider.style.setProperty('--value-percent', `${percent}%`);
}

function setupSettingsModal(): void {
  const modal = document.querySelector('#settings-modal') as HTMLDivElement;
  const toggleBtn = document.querySelector('#settings-toggle') as HTMLButtonElement;
  const closeBtn = document.querySelector('#modal-close') as HTMLButtonElement;
  const applyBtn = document.querySelector('#settings-apply-btn') as HTMLButtonElement;
  const resetBtn = document.querySelector('#settings-reset-btn') as HTMLButtonElement;

  const sizeSlider = document.querySelector('#size-slider') as HTMLInputElement;
  const timeSlider = document.querySelector('#time-slider') as HTMLInputElement;
  const threadsToggle = document.querySelector('#threads-toggle') as HTMLButtonElement;
  const threadsIcon = document.querySelector('#threads-icon') as HTMLSpanElement;
  const labelMulti = document.querySelector('#label-multi') as HTMLSpanElement;
  const labelSingle = document.querySelector('#label-single') as HTMLSpanElement;
  const saveChk = document.querySelector('#save-settings-chk') as HTMLInputElement;
  const radioCum = document.querySelector(
    'input[name="calcMethod"][value="cumulative"]',
  ) as HTMLInputElement;
  const radioPeak = document.querySelector(
    'input[name="calcMethod"][value="peak"]',
  ) as HTMLInputElement;

  const sizeVal = document.querySelector('#size-val') as HTMLSpanElement;
  const timeVal = document.querySelector('#time-val') as HTMLSpanElement;

  if (
    !modal ||
    !toggleBtn ||
    !closeBtn ||
    !sizeSlider ||
    !timeSlider ||
    !threadsToggle ||
    !saveChk ||
    !radioCum ||
    !radioPeak ||
    !applyBtn ||
    !resetBtn
  )
    return;

  let draftSettings = { ...currentSettings };

  const updateUI = (): void => {
    sizeSlider.value = draftSettings.size.toString();
    timeSlider.value = draftSettings.time.toString();
    updateSliderGradient(sizeSlider);
    updateSliderGradient(timeSlider);
    saveChk.checked = draftSettings.save;

    if (draftSettings.calcMethod === 'peak') {
      radioPeak.checked = true;
    } else {
      radioCum.checked = true;
    }

    sizeVal.textContent = draftSettings.size.toString();
    timeVal.textContent = draftSettings.time.toString();

    const isMulti = draftSettings.threads > 1;
    threadsIcon.innerHTML = svgs[`./icons/threads-${isMulti ? 'multi' : 'single'}.svg`] as string;
    labelMulti.classList.toggle('inactive', !isMulti);
    labelSingle.classList.toggle('inactive', isMulti);
    threadsToggle.setAttribute('aria-pressed', isMulti ? 'true' : 'false');
  };

  loadSettings();
  draftSettings = { ...currentSettings };
  updateUI();

  const openModal = (): void => {
    draftSettings = { ...currentSettings };
    modal.classList.remove('hidden');
    updateUI();
  };

  const closeModal = (): void => {
    modal.classList.add('hidden');
  };

  toggleBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!modal.classList.contains('hidden')) {
        closeModal();
      }
    }
  });

  applyBtn.addEventListener('click', () => {
    currentSettings = { ...draftSettings };
    saveSettings();
    closeModal();
  });

  resetBtn.addEventListener('click', () => {
    draftSettings = { ...defaultSettings };
    updateUI();
  });

  sizeSlider.addEventListener('input', (e) => {
    const val = Number.parseInt((e.target as HTMLInputElement).value, 10);
    draftSettings.size = val;
    sizeVal.textContent = val.toString();
    updateSliderGradient(sizeSlider);
  });
  timeSlider.addEventListener('input', (e) => {
    const val = Number.parseInt((e.target as HTMLInputElement).value, 10);
    draftSettings.time = val;
    timeVal.textContent = val.toString();
    updateSliderGradient(timeSlider);
  });
  threadsToggle?.addEventListener('click', () => {
    draftSettings.threads = draftSettings.threads > 1 ? 1 : serverThreads;
    updateUI();
  });
  labelMulti?.addEventListener('click', () => {
    draftSettings.threads = serverThreads;
    updateUI();
  });
  labelSingle?.addEventListener('click', () => {
    draftSettings.threads = 1;
    updateUI();
  });
  saveChk.addEventListener('change', (e) => {
    draftSettings.save = (e.target as HTMLInputElement).checked;
  });
  radioCum.addEventListener('change', (e) => {
    if ((e.target as HTMLInputElement).checked) {
      draftSettings.calcMethod = 'cumulative';
    }
  });
  radioPeak.addEventListener('change', (e) => {
    if ((e.target as HTMLInputElement).checked) {
      draftSettings.calcMethod = 'peak';
    }
  });
}

initTheme();
initLanguage();
injectIcons();
updateThemeIcon();
applyTranslations();
setupLangSelector();
setupSettingsModal();

const debugConfigPromise = loadDebugConfig();

type SampleObj = { speed: number; bytes: number; timeMs: number };
let dlSamples: SampleObj[] = [];
let ulSamples: SampleObj[] = [];
let dlChartSamples: SampleObj[] = [];
let ulChartSamples: SampleObj[] = [];
let dlFinalVal = '';
let ulFinalVal = '';

function setupDetailsModal(): void {
  const modal = document.querySelector('#details-modal') as HTMLDivElement;
  const closeBtn = document.querySelector('#details-close') as HTMLButtonElement;
  const dlBtn = document.querySelector('#dl-info-btn') as HTMLButtonElement;
  const ulBtn = document.querySelector('#ul-info-btn') as HTMLButtonElement;
  const tbody = document.querySelector('#details-tbody') as HTMLTableSectionElement;
  const title = document.querySelector('#details-title') as HTMLHeadingElement;

  if (!modal || !closeBtn || !dlBtn || !ulBtn || !tbody) return;

  const openModal = (
    type: 'Download' | 'Upload',
    samples: SampleObj[],
    finalSpeed: string,
  ): void => {
    title.textContent =
      type === 'Download' ? localize('details_title_dl') : localize('details_title_ul');

    tbody.innerHTML = '';
    const theadRow = document.createElement('tr');

    const thTime = document.createElement('th');
    thTime.setAttribute('data-i18n', 'details_time');
    thTime.textContent = localize('details_time');

    const thSize = document.createElement('th');
    thSize.setAttribute('data-i18n', 'details_size');
    thSize.textContent = localize('details_size');

    const thSpeed = document.createElement('th');
    thSpeed.setAttribute('data-i18n', 'details_speed');
    thSpeed.textContent = localize('details_speed');

    theadRow.appendChild(thTime);
    theadRow.appendChild(thSize);
    theadRow.appendChild(thSpeed);
    tbody.appendChild(theadRow);

    samples.forEach((val) => {
      const timeStr = `${val.timeMs.toFixed(0)} ${localize('unit_ms')}`;
      const sizeStr = `${(val.bytes / 1024 / 1024).toFixed(2)} ${localize('unit_mb')}`;
      const speedStr = `${val.speed.toFixed(2)} ${localize('unit_mbps')}`;

      const tr = document.createElement('tr');
      const tdTime = document.createElement('td');
      const tdSize = document.createElement('td');
      const tdSpeed = document.createElement('td');

      tdTime.textContent = timeStr;
      tdSize.textContent = sizeStr;
      tdSpeed.textContent = speedStr;

      tr.appendChild(tdTime);
      tr.appendChild(tdSize);
      tr.appendChild(tdSpeed);
      tbody.appendChild(tr);
    });

    if (samples.length > 0) {
      const last = samples[samples.length - 1];
      if (!last) return;

      const summaryTr = document.createElement('tr');
      summaryTr.classList.add('details-summary-row');

      const tdSumLabel = document.createElement('td');
      tdSumLabel.setAttribute('colspan', '2');
      const methodKey =
        currentSettings.calcMethod === 'peak'
          ? 'settings_calc_peak_title'
          : 'settings_calc_cum_title';
      tdSumLabel.innerHTML = `${localize('details_summary')}<br><span class="details-method-name">${localize(methodKey)}</span>`;

      const tdSumSpeed = document.createElement('td');
      tdSumSpeed.textContent = `${finalSpeed} ${localize('unit_mbps')}`;

      summaryTr.appendChild(tdSumLabel);
      summaryTr.appendChild(tdSumSpeed);
      tbody.appendChild(summaryTr);
    }

    modal.classList.remove('hidden');
  };

  const closeModal = (): void => {
    modal.classList.add('hidden');
  };

  dlBtn.addEventListener('click', () => openModal('Download', dlSamples, dlFinalVal));
  ulBtn.addEventListener('click', () => openModal('Upload', ulSamples, ulFinalVal));
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeModal();
    }
  });
}

setupDetailsModal();

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

const startBtn = document.querySelector('#startStopBtn') as HTMLDivElement;
let worker: Worker | null = null;
let isRunning = false;

function initUI(): void {
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
}

function stopTest(): void {
  worker?.terminate();
  worker = null;
  isRunning = false;
  startBtn.classList.remove('running');
  applyTranslations();
  initUI();
}

function handlePing(value: string, jitter: string): void {
  const el = document.querySelector('#pingText');
  if (el) el.textContent = value;
  const jel = document.querySelector('#jitText');
  if (jel) jel.textContent = jitter;
}

function handleDlProgress(
  value: string,
  bytes: number,
  timeMs: number,
  samples?: SampleObj[],
  chartSamples?: SampleObj[],
  loadedPing?: string,
): void {
  updateMetric('#dlText', '#dlSubText', value, bytes, timeMs);
  if (loadedPing) {
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
}

function handleDlDone(
  value: string,
  bytes: number,
  timeMs: number,
  samples?: SampleObj[],
  chartSamples?: SampleObj[],
  loadedPing?: string,
): void {
  handleDlProgress(value, bytes, timeMs, samples, chartSamples, loadedPing);
  if (chartSamples) dlChartSamples = chartSamples;
  if (samples) {
    dlSamples = samples;
    dlFinalVal = value;
    document.querySelector('#dl-info-btn')?.classList.remove('hidden');
  }
}

function handleUlProgress(
  value: string,
  bytes: number,
  timeMs: number,
  samples?: SampleObj[],
  chartSamples?: SampleObj[],
  loadedPing?: string,
): void {
  updateMetric('#ulText', '#ulSubText', value, bytes, timeMs);
  if (loadedPing) {
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
}

function handleUlDone(
  value: string,
  bytes: number,
  timeMs: number,
  samples?: SampleObj[],
  chartSamples?: SampleObj[],
  loadedPing?: string,
): void {
  handleUlProgress(value, bytes, timeMs, samples, chartSamples, loadedPing);
  if (chartSamples) ulChartSamples = chartSamples;
  if (samples) {
    ulSamples = samples;
    ulFinalVal = value;
    document.querySelector('#ul-info-btn')?.classList.remove('hidden');
  }
}

function handleWorkerMessage(e: MessageEvent): void {
  const { type, value, jitter, samples, chartSamples, bytes, timeMs, loadedPing } = e.data;
  debugLog('received worker message', { chartSamples, samples, type });
  switch (type) {
    case 'ping':
      handlePing(value, jitter);
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
        startBtn.classList.remove('running');
        applyTranslations();
        worker?.terminate();
        worker = null;
      }
      break;
    }
  }
}

startBtn?.addEventListener('click', async (): Promise<void> => {
  if (isRunning) {
    stopTest();
    return;
  }

  isRunning = true;
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
    .catch(Object);
});

const themeToggleBtn = document.querySelector('#theme-toggle');
themeToggleBtn?.addEventListener('click', (): void => {
  toggleTheme();
  updateThemeIcon();
});
