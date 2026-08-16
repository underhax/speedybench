import './style.css';
import {
  applyTranslations,
  availableLanguages,
  getCurrentLanguage,
  initLanguage,
  setLanguage,
} from './localize.ts';
import { initTheme, toggleTheme } from './theme.ts';

const svgs = import.meta.glob('./icons/*.svg', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
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
  setIcon('ip-icon', 'ip');
  setIcon('lang-icon', 'language');
  setIcon('logo-icon', 'logo');
  setIcon('settings-toggle', 'settings');
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
  size: 100,
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

const startBtn = document.querySelector('#startStopBtn') as HTMLDivElement;
let worker: Worker | null = null;
let isRunning = false;

function initUI(): void {
  const ids = ['dlText', 'ulText', 'pingText', 'jitText', 'ip'];
  ids.forEach((id) => {
    const el = document.querySelector(`#${id}`);
    if (el) el.textContent = '';
  });
}

function stopTest(): void {
  worker?.terminate();
  worker = null;
  isRunning = false;
  startBtn.classList.remove('running');
  applyTranslations();
  initUI();
}

function handleWorkerMessage(e: MessageEvent): void {
  const { type, value, jitter } = e.data;
  switch (type) {
    case 'ping': {
      const el = document.querySelector('#pingText');
      if (el) el.textContent = value;
      const jel = document.querySelector('#jitText');
      if (jel) jel.textContent = jitter;
      break;
    }
    case 'dl_progress':
    case 'dl_done':
      updateMetric('#dlText', '#dlSubText', value, e.data.bytes, e.data.timeMs);
      break;
    case 'ul_progress':
    case 'ul_done':
      updateMetric('#ulText', '#ulSubText', value, e.data.bytes, e.data.timeMs);
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

startBtn?.addEventListener('click', (): void => {
  if (isRunning) {
    stopTest();
    return;
  }

  isRunning = true;
  startBtn.classList.add('running');
  applyTranslations();
  initUI();

  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = handleWorkerMessage;
  worker.postMessage({
    base: window.location.href,
    calcMethod: currentSettings.calcMethod,
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
