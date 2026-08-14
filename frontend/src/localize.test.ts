import './setup.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from './locales/en.ts';
import {
  applyTranslations,
  availableLanguages,
  getCurrentLanguage,
  initLanguage,
  localize,
  setLanguage,
} from './localize.ts';

describe('Localize', () => {
  beforeEach((): void => {
    window.localStorage.clear();
    document.title = '';
    document.body.innerHTML = `
      <div data-i18n="test_key"></div>
      <button id="startStopBtn" class=""></button>
    `;

    Object.defineProperty(navigator, 'language', {
      configurable: true,
      value: 'en-US',
    });
  });

  afterEach((): void => {
    vi.restoreAllMocks();
  });

  it('exports available languages', (): void => {
    expect(availableLanguages.length).toBeGreaterThan(0);
    expect(availableLanguages.some((l) => l.code === 'en')).toBe(true);
  });

  it('initializes language from localStorage', (): void => {
    window.localStorage.setItem('language', 'ru');
    expect(initLanguage()).toBe('ru');
    expect(getCurrentLanguage()).toBe('ru');
  });

  it('initializes language from navigator if no localStorage', (): void => {
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'es-ES' });
    expect(initLanguage()).toBe('es');
    expect(getCurrentLanguage()).toBe('es');
  });

  it('falls back to default if navigator language is unsupported', (): void => {
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'zh-CN' });
    expect(initLanguage()).toBe('en');
  });

  it('sets language and applies translations', (): void => {
    setLanguage('fr');
    expect(getCurrentLanguage()).toBe('fr');
    expect(window.localStorage.getItem('language')).toBe('fr');
  });

  it('ignores setting unsupported language', (): void => {
    const startLang = getCurrentLanguage();
    setLanguage('xx');
    expect(getCurrentLanguage()).toBe(startLang);
  });

  it('localizes a known key', (): void => {
    setLanguage('en');
    expect(localize('start')).toBe('Start');

    setLanguage('ru');
    expect(localize('start')).toBe('Старт');
  });

  it('falls back to english for missing keys in other language', (): void => {
    setLanguage('ru');
    expect(localize('non_existent_key')).toBe('non_existent_key');

    (en as typeof en & { fallback_test_key?: string }).fallback_test_key = 'fallback_success';
    expect(localize('fallback_test_key')).toBe('fallback_success');
    delete (en as typeof en & { fallback_test_key?: string }).fallback_test_key;
  });

  it('applies translations to DOM elements', (): void => {
    setLanguage('ru');

    const el = document.querySelector('[data-i18n="test_key"]');
    expect(el?.textContent).toBe('test_key');

    const btn = document.querySelector('#startStopBtn');
    expect(btn?.textContent).toBe('Старт');

    btn?.classList.add('running');
    applyTranslations();
    expect(btn?.textContent).toBe('Отмена');
  });

  it('handles missing navigator.language', (): void => {
    Object.defineProperty(navigator, 'language', { configurable: true, value: undefined });
    expect(initLanguage()).toBe('en');
  });

  it('ignores elements with empty data-i18n attribute', (): void => {
    const div = document.createElement('div');
    div.setAttribute('data-i18n', '');
    div.textContent = 'original';
    document.body.appendChild(div);

    applyTranslations();

    expect(div.textContent).toBe('original');
  });

  it('handles missing startStopBtn safely', (): void => {
    const btn = document.querySelector('#startStopBtn');
    if (btn) btn.remove();
    setLanguage('ru');
    applyTranslations();
    expect(true).toBe(true);
  });
});
