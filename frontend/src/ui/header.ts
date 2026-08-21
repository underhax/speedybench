import {
  applyTranslations,
  availableLanguages,
  getCurrentLanguage,
  initLanguage,
  setLanguage,
} from '../localize.ts';
import { initTheme, toggleTheme } from '../theme.ts';

const svgs = import.meta.glob('../icons/*.svg', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

export function injectIcons(): void {
  const setIcon = (id: string, name: string): void => {
    const el = document.querySelector(`#${id}`);
    if (el) el.innerHTML = svgs[`../icons/${name}.svg`] as string;
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
  setIcon('details-copy-icon', 'copy');
}

export function updateThemeIcon(): void {
  const isLight = document.documentElement.classList.contains('theme-light');
  const btn = document.querySelector('#theme-toggle');
  if (btn) btn.innerHTML = svgs[`../icons/theme-${isLight ? 'dark' : 'light'}.svg`] as string;
}

export function setupThemeToggle(): void {
  const themeToggleBtn = document.querySelector('#theme-toggle');
  themeToggleBtn?.addEventListener('click', (): void => {
    toggleTheme();
    updateThemeIcon();
  });
}

export function setupLangSelector(): void {
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

export function setupHeader(): void {
  initTheme();
  initLanguage();
  injectIcons();
  updateThemeIcon();
  applyTranslations();
  setupLangSelector();
  setupThemeToggle();
}
