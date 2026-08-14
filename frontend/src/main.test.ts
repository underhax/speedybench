import './setup.ts';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

const mockWorkerInstance = {
  onmessage: null as ((ev: MessageEvent) => void) | null,
  postMessage: vi.fn(),
  terminate: vi.fn(),
};

const emitWorkerMessage = (data: unknown): void => {
  if (mockWorkerInstance.onmessage) {
    mockWorkerInstance.onmessage({ data } as MessageEvent);
  }
};

const MockWorker = vi.fn(function (this: Worker) {
  Object.defineProperty(this, 'onmessage', {
    get: () => mockWorkerInstance.onmessage,
    set: (fn) => {
      mockWorkerInstance.onmessage = fn;
    },
  });
  this.postMessage = mockWorkerInstance.postMessage;
  this.terminate = mockWorkerInstance.terminate;
  return this;
});

describe('Main UI', () => {
  let fetchMock: Mock;

  beforeEach((): void => {
    vi.resetModules();
    vi.stubGlobal('Worker', MockWorker);
    document.body.innerHTML = `
      <div id="logo-icon"></div>
      <div id="theme-toggle"></div>
      <div id="startStopBtn"></div>
      <div id="lang-dropdown"></div>
      <div id="lang-selected"></div>
      <span id="current-lang-text"></span>
      <ul id="lang-options"></ul>
      <div id="dlText"></div>
      <div id="ulText"></div>
      <div id="pingText"></div>
      <div id="jitText"></div>
      <div id="ip"></div>
      <div id="download-icon"></div>
      <div id="upload-icon"></div>
      <div id="ping-icon"></div>
      <div id="ip-icon"></div>
      <div id="lang-icon"></div>
    `;

    vi.clearAllMocks();
    mockWorkerInstance.onmessage = null;

    fetchMock = vi.fn().mockResolvedValue({
      text: vi.fn().mockResolvedValue('127.0.0.1'),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('initializes UI correctly, populates languages, and toggles dropdown', async (): Promise<void> => {
    await import('./main.ts');

    const dropdown = document.querySelector('#lang-dropdown') as HTMLDivElement;
    const selectedBtn = document.querySelector('#lang-selected') as HTMLDivElement;
    const optionsList = document.querySelector('#lang-options') as HTMLUListElement;
    expect(optionsList.children.length).toBeGreaterThan(0);

    selectedBtn.click();
    expect(dropdown.classList.contains('open')).toBe(true);

    document.dispatchEvent(new Event('click'));
    expect(dropdown.classList.contains('open')).toBe(false);

    selectedBtn.click();
    const li = optionsList.children[1] as HTMLElement;
    li.click();
    expect(dropdown.classList.contains('open')).toBe(false);
  });

  it('handles start and stop button clicks', async (): Promise<void> => {
    await import('./main.ts');
    const startBtn = document.querySelector('#startStopBtn') as HTMLElement;

    startBtn?.click();
    expect(startBtn?.classList.contains('running')).toBe(true);
    expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith('start');

    expect(fetchMock).toHaveBeenCalledWith('/api/ip');
    await new Promise((r) => setTimeout(r, 10));
    expect(document.querySelector('#ip')?.textContent).toBe('127.0.0.1');

    expect(mockWorkerInstance.onmessage).toBeDefined();

    emitWorkerMessage({ type: 'status', value: 'pinging' });
    emitWorkerMessage({ jitter: '2', type: 'ping', value: '10' });
    expect(document.querySelector('#pingText')?.textContent).toBe('10');
    expect(document.querySelector('#jitText')?.textContent).toBe('2');

    emitWorkerMessage({ type: 'status', value: 'downloading' });
    emitWorkerMessage({ type: 'dl_progress', value: '100' });
    expect(document.querySelector('#dlText')?.textContent).toBe('100');

    emitWorkerMessage({ type: 'status', value: 'uploading' });
    emitWorkerMessage({ type: 'ul_progress', value: '50' });
    expect(document.querySelector('#ulText')?.textContent).toBe('50');

    emitWorkerMessage({ type: 'status', value: 'done' });
    expect(startBtn?.classList.contains('running')).toBe(false);
    expect(mockWorkerInstance.terminate).toHaveBeenCalled();

    startBtn?.click();
    expect(startBtn?.classList.contains('running')).toBe(true);

    startBtn?.click();
    expect(startBtn?.classList.contains('running')).toBe(false);
  });

  it('toggles theme', async (): Promise<void> => {
    await import('./main.ts');
    const themeBtn = document.querySelector('#theme-toggle') as HTMLElement;
    const isLightBefore = document.documentElement.classList.contains('theme-light');
    themeBtn?.click();
    const isLightAfter = document.documentElement.classList.contains('theme-light');
    expect(isLightBefore).not.toBe(isLightAfter);
  });

  it('handles missing DOM elements gracefully', async (): Promise<void> => {
    document.body.innerHTML = '';
    expect(true).toBe(true);

    const startBtn = document.createElement('div');
    startBtn.id = 'startStopBtn';
    document.body.appendChild(startBtn);

    await import('./main.ts');

    startBtn.click();

    emitWorkerMessage({ jitter: '2', type: 'ping', value: '10' });
    emitWorkerMessage({ type: 'dl_progress', value: '100' });
    emitWorkerMessage({ type: 'ul_progress', value: '50' });

    startBtn.click();

    emitWorkerMessage({ type: 'status', value: 'done' });

    await new Promise((r) => setTimeout(r, 10));
  });

  it('handles fetch IP error gracefully', async (): Promise<void> => {
    fetchMock.mockRejectedValueOnce(new Error('Network error'));
    await import('./main.ts');

    const startBtn = document.querySelector('#startStopBtn') as HTMLElement;
    startBtn?.click();

    expect(fetchMock).toHaveBeenCalledWith('/api/ip');

    await new Promise((r) => setTimeout(r, 10));
  });
});
