import { type Mock, vi } from 'vitest';

type MockStorage = {
  clear: Mock;
  getItem: Mock;
  removeItem: Mock;
  setItem: Mock;
};

const localStorageMock = ((): MockStorage => {
  let store: Record<string, string> = {};
  return {
    clear: vi.fn((): void => {
      store = {};
    }),
    getItem: vi.fn((key: string): string | null => store[key] ?? null),
    removeItem: vi.fn((key: string): void => {
      delete store[key];
    }),
    setItem: vi.fn((key: string, value: string): void => {
      store[key] = value;
    }),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

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
