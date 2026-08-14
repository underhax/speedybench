import { de } from './locales/de.ts';
import { en } from './locales/en.ts';
import { es } from './locales/es.ts';
import { fr } from './locales/fr.ts';
import { ru } from './locales/ru.ts';
import { uk } from './locales/uk.ts';

type LangCode = 'de' | 'en' | 'es' | 'fr' | 'ru' | 'uk';
type TranslationDict = Record<string, string>;

const translations: Record<LangCode, TranslationDict> = {
  de,
  en,
  es,
  fr,
  ru,
  uk,
};

let currentLanguage = 'en';

export const availableLanguages = [
  { code: 'en', name: 'English' },
  { code: 'ru', name: 'Русский' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'uk', name: 'Українська' },
];

export function initLanguage(): string {
  const saved = window.localStorage.getItem('language');
  if (saved && saved in translations) {
    currentLanguage = saved;
  } else {
    currentLanguage = 'en';
    const browserLang = navigator.language?.split('-')[0] ?? '';
    if (browserLang && browserLang in translations) {
      currentLanguage = browserLang;
    }
  }
  return currentLanguage;
}

export function setLanguage(lang: string): void {
  if (lang in translations) {
    currentLanguage = lang;
    window.localStorage.setItem('language', lang);
    applyTranslations();
  }
}

export function localize(key: string): string {
  const dictionary = translations[currentLanguage as keyof typeof translations];
  return dictionary?.[key] ?? translations.en[key] ?? key;
}

export function applyTranslations(): void {
  document.title = `${localize('title')} \u22c6 SpeedyBench`;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) {
      el.textContent = localize(key);
    }
  });

  const startBtn = document.querySelector('#startStopBtn');
  if (startBtn && !startBtn.classList.contains('running')) {
    startBtn.textContent = localize('start');
  } else if (startBtn) {
    startBtn.textContent = localize('cancel');
  }
}

export function getCurrentLanguage(): string {
  return currentLanguage;
}
