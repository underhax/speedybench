import './setup.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initTheme, toggleTheme } from './theme.ts';

describe('Theme', () => {
  beforeEach((): void => {
    window.localStorage.clear();
    document.documentElement.className = '';

    Object.defineProperty(window, 'matchMedia', {
      value: vi.fn().mockImplementation((query) => ({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: false,
        media: query,
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn(),
      })),
      writable: true,
    });
  });

  afterEach((): void => {
    vi.restoreAllMocks();
  });

  it('initializes from localStorage', (): void => {
    window.localStorage.setItem('theme', 'theme-light');
    initTheme();
    expect(document.documentElement.className).toBe('theme-light');
  });

  it('initializes from matchMedia (prefers-color-scheme: light) if no localStorage', (): void => {
    window.matchMedia = vi.fn().mockImplementation(() => ({ matches: true }));
    initTheme();
    expect(document.documentElement.className).toBe('theme-light');
  });

  it('initializes from matchMedia (prefers-color-scheme: dark) if no localStorage', (): void => {
    window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false }));
    initTheme();
    expect(document.documentElement.className).toBe('theme-dark');
  });

  it('toggles theme', (): void => {
    document.documentElement.className = 'theme-light';
    toggleTheme();
    expect(document.documentElement.className).toBe('theme-dark');
    expect(window.localStorage.getItem('theme')).toBe('theme-dark');

    toggleTheme();
    expect(document.documentElement.className).toBe('theme-light');
    expect(window.localStorage.getItem('theme')).toBe('theme-light');
  });
});
