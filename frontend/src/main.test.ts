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
      <div id="dlSubText"></div>
      <div id="ulText"></div>
      <div id="ulSubText"></div>
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
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="settings-toggle"></div><div id="settings-modal"><button id="modal-close"></button><span id="size-val"></span><input type="range" id="size-slider" min="10" max="1000" step="10" value="100"><span id="time-val"></span><input type="range" id="time-slider" min="10" max="30" step="5" value="15"><span id="label-multi"></span><button id="threads-toggle"></button><span id="threads-icon"></span><span id="label-single"></span><input type="checkbox" id="save-settings-chk"><button id="settings-apply-btn"></button><button id="settings-reset-btn"></button></div>',
    );

    localStorage.setItem(
      'speedybench_settings',
      JSON.stringify({ save: true, size: 100, threads: 1, time: 15 }),
    );
    const { initServerInfo } = await import('./main.ts');
    await initServerInfo();

    const threadsToggle = document.querySelector('#threads-toggle') as HTMLButtonElement;
    threadsToggle.click();
    expect(threadsToggle.getAttribute('aria-pressed')).toBe('true');
    await initServerInfo();

    fetchMock.mockResolvedValueOnce({ text: vi.fn().mockResolvedValue('0') });
    await initServerInfo();

    fetchMock.mockResolvedValueOnce({ text: vi.fn().mockResolvedValue('abc') });
    await initServerInfo();

    fetchMock.mockRejectedValueOnce(new Error('Network error'));
    await initServerInfo();

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
    expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        base: window.location.href,
        type: 'start',
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(new URL('./api/ip', window.location.href));
    await new Promise((r) => setTimeout(r, 10));
    expect(document.querySelector('#ip')?.textContent).toBe('127.0.0.1');

    expect(mockWorkerInstance.onmessage).toBeDefined();

    emitWorkerMessage({ type: 'status', value: 'pinging' });
    emitWorkerMessage({ jitter: '2', type: 'ping', value: '10' });
    expect(document.querySelector('#pingText')?.textContent).toBe('10');
    expect(document.querySelector('#jitText')?.textContent).toBe('2');

    emitWorkerMessage({ type: 'status', value: 'downloading' });
    emitWorkerMessage({ bytes: 0, timeMs: 0, type: 'dl_progress', value: '100' });
    expect(document.querySelector('#dlText')?.textContent).toBe('100');
    expect(document.querySelector('#dlSubText')?.textContent).toBe('0 MB / 0.0 s');

    emitWorkerMessage({ bytes: 5242880, timeMs: 1500, type: 'dl_progress', value: '120' });
    expect(document.querySelector('#dlText')?.textContent).toBe('120');
    expect(document.querySelector('#dlSubText')?.textContent).toBe('5.0 MB / 1.5 s');

    emitWorkerMessage({ type: 'status', value: 'uploading' });
    emitWorkerMessage({ bytes: 10485760, timeMs: 2000, type: 'ul_progress', value: '50' });
    expect(document.querySelector('#ulText')?.textContent).toBe('50');
    expect(document.querySelector('#ulSubText')?.textContent).toBe('10.0 MB / 2.0 s');

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

    expect(fetchMock).toHaveBeenCalledWith(new URL('./api/ip', window.location.href));

    await new Promise((r) => setTimeout(r, 10));
  });

  it('handles settings modal interactions and persistence', async (): Promise<void> => {
    document.body.innerHTML = `
      <div id="settings-toggle"></div>
      <div id="settings-modal" class="hidden">
        <button id="modal-close"></button>
        <span id="size-val"></span>
        <input type="range" id="size-slider" min="10" max="1000" step="10" value="100">
        <span id="time-val"></span>
        <input type="range" id="time-slider" min="10" max="30" step="5" value="15">
        <span id="label-multi"></span>
        <button id="threads-toggle"></button>
        <span id="threads-icon"></span>
        <span id="label-single"></span>
        <input type="checkbox" id="save-settings-chk">
        <button id="settings-apply-btn"></button>
        <button id="settings-reset-btn"></button>
      </div>
    `;

    localStorage.setItem(
      'speedybench_settings',
      JSON.stringify({ save: true, size: 200, threads: 8, time: 20 }),
    );
    await import('./main.ts');

    const toggleBtn = document.querySelector('#settings-toggle') as HTMLElement;
    const modal = document.querySelector('#settings-modal') as HTMLElement;

    expect(document.querySelector('#size-val')?.textContent).toBe('200');

    toggleBtn.click();
    expect(modal.classList.contains('hidden')).toBe(false);

    const sizeSlider = document.querySelector('#size-slider') as HTMLInputElement;
    sizeSlider.value = '500';
    sizeSlider.dispatchEvent(new Event('input'));
    expect(document.querySelector('#size-val')?.textContent).toBe('500');

    const timeSlider = document.querySelector('#time-slider') as HTMLInputElement;
    timeSlider.value = '30';
    timeSlider.dispatchEvent(new Event('input'));
    expect(document.querySelector('#time-val')?.textContent).toBe('30');

    const resetBtn = document.querySelector('#settings-reset-btn') as HTMLElement;
    resetBtn.click();
    expect(document.querySelector('#size-val')?.textContent).toBe('100');
    expect(document.querySelector('#time-val')?.textContent).toBe('15');

    sizeSlider.value = '500';
    sizeSlider.dispatchEvent(new Event('input'));
    timeSlider.value = '25';
    timeSlider.dispatchEvent(new Event('input'));

    const threadsToggle = document.querySelector('#threads-toggle') as HTMLButtonElement;
    threadsToggle.click();
    expect(threadsToggle.getAttribute('aria-pressed')).toBe('false');
    threadsToggle.click();
    expect(threadsToggle.getAttribute('aria-pressed')).toBe('true');

    const labelSingle = document.querySelector('#label-single') as HTMLElement;
    const labelMulti = document.querySelector('#label-multi') as HTMLElement;

    labelSingle.click();
    expect(threadsToggle.getAttribute('aria-pressed')).toBe('false');
    labelMulti.click();
    expect(threadsToggle.getAttribute('aria-pressed')).toBe('true');

    const saveChk = document.querySelector('#save-settings-chk') as HTMLInputElement;
    saveChk.checked = false;
    saveChk.dispatchEvent(new Event('change'));

    const applyBtn = document.querySelector('#settings-apply-btn') as HTMLElement;
    applyBtn.click();
    expect(modal.classList.contains('hidden')).toBe(true);

    expect(sessionStorage.getItem('speedybench_settings')).toContain('"size":500');
    expect(localStorage.getItem('speedybench_settings')).toBeNull();

    await import('./main.ts');
    expect(document.querySelector('#size-val')?.textContent).toBe('500');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    toggleBtn.click();
    Object.defineProperty(MouseEvent.prototype, 'target', { configurable: true, value: modal });
    modal.click();
    expect(modal.classList.contains('hidden')).toBe(true);

    toggleBtn.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  it('handles invalid json in storage gracefully', async (): Promise<void> => {
    document.body.innerHTML =
      '<div id="settings-toggle"></div><div id="settings-modal" class="hidden"><button id="modal-close"></button><span id="size-val"></span><input type="range" id="size-slider" min="10" max="1000" step="10" value="100"><span id="time-val"></span><input type="range" id="time-slider" min="10" max="30" step="5" value="15"><span id="label-multi"></span><button id="threads-toggle"></button><span id="threads-icon"></span><span id="label-single"></span><input type="checkbox" id="save-settings-chk"><button id="settings-apply-btn"></button><button id="settings-reset-btn"></button></div>';

    localStorage.setItem('speedybench_settings', '{invalid json}');
    sessionStorage.removeItem('speedybench_settings');
    await import('./main.ts');

    localStorage.removeItem('speedybench_settings');
    sessionStorage.setItem('speedybench_settings', '{invalid json}');
    await import('./main.ts');

    expect(true).toBe(true);
  });

  it('saves to localStorage when save is checked', async (): Promise<void> => {
    document.body.innerHTML =
      '<div id="settings-toggle"></div><div id="settings-modal" class="hidden"><button id="modal-close"></button><span id="size-val"></span><input type="range" id="size-slider" min="10" max="1000" step="10" value="100"><span id="time-val"></span><input type="range" id="time-slider" min="10" max="30" step="5" value="15"><span id="label-multi"></span><button id="threads-toggle"></button><span id="threads-icon"></span><span id="label-single"></span><input type="checkbox" id="save-settings-chk"><button id="settings-apply-btn"></button><button id="settings-reset-btn"></button></div>';
    await import('./main.ts');
    await import('./main.ts');

    const toggleBtn = document.querySelector('#settings-toggle') as HTMLElement;
    const saveChk = document.querySelector('#save-settings-chk') as HTMLInputElement;

    toggleBtn.click();
    saveChk.checked = true;
    saveChk.dispatchEvent(new Event('change'));
    const applyBtn = document.querySelector('#settings-apply-btn') as HTMLElement;
    applyBtn.click();

    expect(localStorage.getItem('speedybench_settings')).toContain('"save":true');
  });

  it('uses default fallback for missing hardwareConcurrency', async (): Promise<void> => {
    vi.stubGlobal('navigator', { hardwareConcurrency: undefined });

    document.body.innerHTML =
      '<div id="settings-toggle"></div><div id="settings-modal" class="hidden"><button id="modal-close"></button><span id="size-val"></span><input type="range" id="size-slider" min="10" max="1000" step="10" value="100"><span id="time-val"></span><input type="range" id="time-slider" min="10" max="30" step="5" value="15"><span id="label-multi"></span><button id="threads-toggle"></button><span id="threads-icon"></span><span id="label-single"></span><input type="checkbox" id="save-settings-chk"><button id="settings-apply-btn"></button><button id="settings-reset-btn"></button></div>';

    localStorage.removeItem('speedybench_settings');
    sessionStorage.removeItem('speedybench_settings');
    await import('./main.ts');

    expect(document.querySelector('#threads-toggle')?.getAttribute('aria-pressed')).toBe('true');

    vi.unstubAllGlobals();
  });

  it('loads settings from sessionStorage correctly', async (): Promise<void> => {
    document.body.innerHTML =
      '<div id="settings-toggle"></div><div id="settings-modal" class="hidden"><button id="modal-close"></button><span id="size-val"></span><input type="range" id="size-slider" min="10" max="1000" step="10" value="100"><span id="time-val"></span><input type="range" id="time-slider" min="10" max="30" step="5" value="15"><span id="label-multi"></span><button id="threads-toggle"></button><span id="threads-icon"></span><span id="label-single"></span><input type="checkbox" id="save-settings-chk"><button id="settings-apply-btn"></button><button id="settings-reset-btn"></button></div>';

    localStorage.removeItem('speedybench_settings');
    sessionStorage.setItem(
      'speedybench_settings',
      JSON.stringify({ save: false, size: 999, threads: 8, time: 20 }),
    );
    await import('./main.ts');

    expect(document.querySelector('#size-val')?.textContent).toBe('999');
  });
});
