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

initTheme();
initLanguage();
injectIcons();
updateThemeIcon();
applyTranslations();
setupLangSelector();

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
    case 'dl_done': {
      const el = document.querySelector('#dlText');
      if (el) el.textContent = value;
      break;
    }
    case 'ul_progress':
    case 'ul_done': {
      const el = document.querySelector('#ulText');
      if (el) el.textContent = value;
      break;
    }
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
  worker.postMessage('start');

  fetch('/api/ip')
    .then((res: Response): Promise<string> => res.text())
    .then((ip: string): void => {
      const ipText = document.querySelector('#ip');
      if (ipText) ipText.textContent = ip;
    })
    .catch(() => {});
});

const themeToggleBtn = document.querySelector('#theme-toggle');
themeToggleBtn?.addEventListener('click', (): void => {
  toggleTheme();
  updateThemeIcon();
});
