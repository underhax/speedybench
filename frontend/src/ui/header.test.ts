import '../setup.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { getCurrentLanguage, setLanguage } from '../localize.ts';
import {
  injectIcons,
  setupHeader,
  setupLangSelector,
  setupThemeToggle,
  updateThemeIcon,
} from './header.ts';

describe('Header', () => {
  beforeEach((): void => {
    localStorage.clear();
    sessionStorage.clear();
    document.documentElement.className = '';
    document.body.innerHTML = `
      <div id="download-icon"></div>
      <div id="upload-icon"></div>
      <div id="ping-icon"></div>
      <div id="dl-ping-icon"></div>
      <div id="ul-ping-icon"></div>
      <div id="jitter-icon"></div>
      <div id="ip-icon"></div>
      <div id="lang-icon"></div>
      <div id="logo-icon"></div>
      <div id="settings-toggle"></div>
      <div id="dl-info-icon"></div>
      <div id="ul-info-icon"></div>
      <div id="details-copy-icon"></div>
      <button id="theme-toggle"></button>
      <div id="lang-dropdown"></div>
      <div id="lang-selected"></div>
      <span id="current-lang-text"></span>
      <ul id="lang-options"></ul>
    `;
  });

  it('injects icons into DOM elements and handles missing elements gracefully', (): void => {
    injectIcons();
    const downloadIcon = document.querySelector('#download-icon');
    expect(downloadIcon?.innerHTML).toContain('svg');

    document.body.innerHTML = '';
    expect((): void => injectIcons()).not.toThrow();
  });

  it('updates theme icon based on light and dark theme', (): void => {
    const btn = document.querySelector('#theme-toggle') as HTMLElement;
    updateThemeIcon();
    expect(btn.innerHTML).toContain('svg');

    document.documentElement.classList.add('theme-light');
    updateThemeIcon();
    expect(btn.innerHTML).toContain('svg');

    document.body.innerHTML = '';
    expect((): void => updateThemeIcon()).not.toThrow();
  });

  it('toggles theme when theme toggle button is clicked', (): void => {
    setupThemeToggle();
    const btn = document.querySelector('#theme-toggle') as HTMLElement;
    btn.click();
    expect(document.documentElement.classList.contains('theme-light')).toBe(true);

    btn.click();
    expect(document.documentElement.classList.contains('theme-light')).toBe(false);
  });

  it('handles language selector interactions, dropdown toggling, and language change', (): void => {
    setLanguage('en');
    setupLangSelector();

    const dropdown = document.querySelector('#lang-dropdown') as HTMLDivElement;
    const selectedBtn = document.querySelector('#lang-selected') as HTMLDivElement;
    const currentLangText = document.querySelector('#current-lang-text') as HTMLSpanElement;
    const optionsList = document.querySelector('#lang-options') as HTMLUListElement;

    expect(currentLangText.textContent).toBe('EN');
    expect(optionsList.children.length).toBeGreaterThan(0);

    selectedBtn.click();
    expect(dropdown.classList.contains('open')).toBe(true);

    document.dispatchEvent(new Event('click'));
    expect(dropdown.classList.contains('open')).toBe(false);

    selectedBtn.click();
    const secondOption = optionsList.children[1] as HTMLElement;
    secondOption.click();

    expect(dropdown.classList.contains('open')).toBe(false);
    expect(secondOption.classList.contains('active')).toBe(true);
    expect(getCurrentLanguage()).not.toBe('');
  });

  it('handles missing DOM elements for language selector gracefully', (): void => {
    document.body.innerHTML = '';
    expect((): void => setupLangSelector()).not.toThrow();
  });

  it('initializes entire header via setupHeader', (): void => {
    expect((): void => setupHeader()).not.toThrow();
    const logoIcon = document.querySelector('#logo-icon');
    expect(logoIcon?.innerHTML).toContain('svg');
  });
});
