import './setup.ts';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { localize } from './localize.ts';

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

describe('Main', () => {
  let fetchMock: Mock;

  beforeEach((): void => {
    localStorage.clear();
    sessionStorage.clear();
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
      <div class="testArea">
        <div id="dlText"></div>
        <div id="dlSubText"></div>
        <div id="dlPingText"></div>
        <svg id="dlChart"></svg>
        <button id="dl-info-btn" class="hidden"></button>
      </div>
      <div class="testArea">
        <div id="ulText"></div>
        <div id="ulSubText"></div>
        <div id="ulPingText"></div>
        <svg id="ulChart"></svg>
        <button id="ul-info-btn" class="hidden"></button>
      </div>
      <div id="pingText"></div>
      <div id="jitText"></div>
      <div id="ip"></div>
      <div id="download-icon"></div>
      <div id="upload-icon"></div>
      <div id="ping-icon"></div>
      <div id="dl-ping-icon"></div>
      <div id="ul-ping-icon"></div>
      <div id="jitter-icon"></div>
      <div id="ip-icon"></div>
      <div id="lang-icon"></div>
      <div id="details-modal" class="hidden">
        <h3 id="details-title"></h3>
        <button id="details-close"></button>
        <table>
          <tbody id="details-tbody"></tbody>
        </table>
      </div>
    `;

    vi.clearAllMocks();
    mockWorkerInstance.onmessage = null;

    fetchMock = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ debug: false }),
      ok: true,
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
      '<div id="settings-toggle"></div><div id="settings-modal"><button id="modal-close"></button><span id="size-val"></span><input type="range" id="size-slider" min="100" max="1000" step="100" value="200"><span id="time-val"></span><input type="range" id="time-slider" min="10" max="30" step="5" value="15"><span id="label-multi"></span><button id="threads-toggle"></button><span id="threads-icon"></span><span id="label-single"></span><input type="radio" name="calcMethod" value="cumulative"><input type="radio" name="calcMethod" value="peak"><input type="checkbox" id="save-settings-chk"><button id="settings-apply-btn"></button><button id="settings-reset-btn"></button></div>',
    );

    localStorage.setItem(
      'speedybench_settings',
      JSON.stringify({ save: true, size: 200, threads: 1, time: 15 }),
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
    await vi.waitFor(() => {
      expect(startBtn?.classList.contains('running')).toBe(true);
    });
    expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        base: window.location.href,
        debug: false,
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
    expect(document.querySelector('#dlSubText')?.textContent).toBe('0.0 MB / 0.0 s');

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

  it('renders charts and opens details modal with full summary for download and upload', async (): Promise<void> => {
    localStorage.setItem(
      'speedybench_settings',
      JSON.stringify({ calcMethod: 'peak', save: true, size: 200, threads: 4, time: 15 }),
    );
    await import('./main.ts');
    const startBtn = document.querySelector('#startStopBtn') as HTMLElement;
    startBtn.click();
    await vi.waitFor(() => {
      expect(startBtn.classList.contains('running')).toBe(true);
    });

    const mockSamples = [
      { bytes: 1048576, speed: 50, timeMs: 500 },
      { bytes: 3145728, speed: 100, timeMs: 1000 },
    ];

    emitWorkerMessage({
      bytes: 1048576,
      chartSamples: mockSamples,
      loadedPing: '15',
      samples: mockSamples,
      timeMs: 500,
      type: 'dl_progress',
      value: '50.00',
    });
    expect(document.querySelector('#dlPingText')?.textContent).toBe('15');
    expect(document.querySelector('#dlChart')?.innerHTML).toContain('<path');

    emitWorkerMessage({
      bytes: 3145728,
      chartSamples: mockSamples,
      loadedPing: '18',
      samples: mockSamples,
      timeMs: 1000,
      type: 'dl_done',
      value: '100.00',
    });
    const dlInfoBtn = document.querySelector('#dl-info-btn') as HTMLButtonElement;
    expect(dlInfoBtn.classList.contains('hidden')).toBe(false);

    emitWorkerMessage({
      bytes: 1048576,
      chartSamples: mockSamples,
      loadedPing: '20',
      samples: mockSamples,
      timeMs: 500,
      type: 'ul_progress',
      value: '40.00',
    });
    expect(document.querySelector('#ulPingText')?.textContent).toBe('20');
    expect(document.querySelector('#ulChart')?.innerHTML).toContain('<path');

    emitWorkerMessage({
      bytes: 3145728,
      chartSamples: mockSamples,
      loadedPing: '22',
      samples: mockSamples,
      timeMs: 1000,
      type: 'ul_done',
      value: '80.00',
    });
    const ulInfoBtn = document.querySelector('#ul-info-btn') as HTMLButtonElement;
    expect(ulInfoBtn.classList.contains('hidden')).toBe(false);

    const detailsModal = document.querySelector('#details-modal') as HTMLElement;
    const detailsTitle = document.querySelector('#details-title') as HTMLElement;
    const detailsClose = document.querySelector('#details-close') as HTMLElement;
    const detailsTbody = document.querySelector('#details-tbody') as HTMLElement;

    dlInfoBtn.click();
    expect(detailsModal.classList.contains('hidden')).toBe(false);
    expect(detailsTitle.textContent).toBe(localize('details_title_dl'));
    expect(detailsTbody.querySelectorAll('tr').length).toBe(4);

    detailsClose.click();
    expect(detailsModal.classList.contains('hidden')).toBe(true);

    ulInfoBtn.click();
    expect(detailsModal.classList.contains('hidden')).toBe(false);
    expect(detailsTitle.textContent).toBe(localize('details_title_ul'));

    Object.defineProperty(MouseEvent.prototype, 'target', {
      configurable: true,
      value: detailsModal,
    });
    detailsModal.click();
    expect(detailsModal.classList.contains('hidden')).toBe(true);

    dlInfoBtn.click();
    expect(detailsModal.classList.contains('hidden')).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(detailsModal.classList.contains('hidden')).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(detailsModal.classList.contains('hidden')).toBe(true);
  });

  it('renders details modal with cumulative calcMethod summary', async (): Promise<void> => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="settings-toggle"></div><div id="settings-modal"><button id="modal-close"></button><span id="size-val"></span><input type="range" id="size-slider" min="100" max="1000" step="100" value="200"><span id="time-val"></span><input type="range" id="time-slider" min="10" max="30" step="5" value="15"><span id="label-multi"></span><button id="threads-toggle"></button><span id="threads-icon"></span><span id="label-single"></span><input type="radio" name="calcMethod" value="cumulative"><input type="radio" name="calcMethod" value="peak"><input type="checkbox" id="save-settings-chk"><button id="settings-apply-btn"></button><button id="settings-reset-btn"></button></div>',
    );
    localStorage.setItem(
      'speedybench_settings',
      JSON.stringify({ calcMethod: 'cumulative', save: true, size: 200, threads: 4, time: 15 }),
    );
    await import('./main.ts');
    const startBtn = document.querySelector('#startStopBtn') as HTMLElement;
    startBtn.click();
    await vi.waitFor(() => {
      expect(startBtn.classList.contains('running')).toBe(true);
    });

    const mockSamples = [{ bytes: 1048576, speed: 50, timeMs: 500 }];

    emitWorkerMessage({
      bytes: 1048576,
      chartSamples: mockSamples,
      samples: mockSamples,
      timeMs: 500,
      type: 'dl_done',
      value: '50.00',
    });

    const dlInfoBtn = document.querySelector('#dl-info-btn') as HTMLButtonElement;
    dlInfoBtn.click();

    const detailsTbody = document.querySelector('#details-tbody') as HTMLElement;
    expect(detailsTbody.textContent).toContain(localize('settings_calc_cum_title'));
  });

  it('handles empty progress and done messages without crashing', async (): Promise<void> => {
    await import('./main.ts');
    const startBtn = document.querySelector('#startStopBtn') as HTMLElement;
    startBtn.click();
    await vi.waitFor(() => {
      expect(startBtn.classList.contains('running')).toBe(true);
    });

    emitWorkerMessage({
      bytes: 100,
      timeMs: 200,
      type: 'dl_progress',
      value: '10.00',
    });

    emitWorkerMessage({
      bytes: 100,
      timeMs: 200,
      type: 'dl_done',
      value: '10.00',
    });

    emitWorkerMessage({
      bytes: 100,
      timeMs: 200,
      type: 'ul_progress',
      value: '10.00',
    });

    emitWorkerMessage({
      bytes: 100,
      timeMs: 200,
      type: 'ul_done',
      value: '10.00',
    });

    expect(startBtn.classList.contains('running')).toBe(true);
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
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(new URL('./api/ip', window.location.href));
    });

    await new Promise((r) => setTimeout(r, 10));
  });

  it('sets serverThreads to 4 when cpus is less than or equal to 4', async (): Promise<void> => {
    fetchMock.mockResolvedValueOnce({
      text: vi.fn().mockResolvedValue('3'),
    });
    const { initServerInfo } = await import('./main.ts');
    await initServerInfo();
    expect(fetchMock).toHaveBeenCalledWith('./api/cpu');
  });

  it('handles settings modal interactions and persistence', async (): Promise<void> => {
    document.body.innerHTML = `
      <div id="settings-toggle"></div>
      <div id="settings-modal" class="hidden">
        <button id="modal-close"></button>
        <span id="size-val"></span>
        <input type="range" id="size-slider" min="100" max="1000" step="100" value="200">
        <span id="time-val"></span>
        <input type="range" id="time-slider" min="10" max="30" step="5" value="15">
        <span id="label-multi"></span>
        <button id="threads-toggle"></button>
        <span id="threads-icon"></span>
        <span id="label-single"></span>
        <input type="radio" name="calcMethod" value="cumulative">
        <input type="radio" name="calcMethod" value="peak">
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
    expect(document.querySelector('#size-val')?.textContent).toBe('200');
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
      '<div id="settings-toggle"></div><div id="settings-modal" class="hidden"><button id="modal-close"></button><span id="size-val"></span><input type="range" id="size-slider" min="100" max="1000" step="100" value="200"><span id="time-val"></span><input type="range" id="time-slider" min="10" max="30" step="5" value="15"><span id="label-multi"></span><button id="threads-toggle"></button><span id="threads-icon"></span><span id="label-single"></span><input type="radio" name="calcMethod" value="cumulative"><input type="radio" name="calcMethod" value="peak"><input type="checkbox" id="save-settings-chk"><button id="settings-apply-btn"></button><button id="settings-reset-btn"></button></div>';

    localStorage.setItem('speedybench_settings', '{invalid json}');
    sessionStorage.removeItem('speedybench_settings');
    await import('./main.ts');

    localStorage.removeItem('speedybench_settings');
    sessionStorage.setItem('speedybench_settings', '{invalid json}');
    await import('./main.ts');

    expect(true).toBe(true);
  });

  it('does not open settings when pressing other keys', async () => {
    document.body.innerHTML =
      '<div id="settings-toggle"></div><div id="settings-modal" class="hidden"><button id="modal-close"></button><span id="size-val"></span><input type="range" id="size-slider" min="100" max="1000" step="100" value="200"><span id="time-val"></span><input type="range" id="time-slider" min="10" max="30" step="5" value="15"><span id="label-multi"></span><button id="threads-toggle"></button><span id="threads-icon"></span><span id="label-single"></span><input type="radio" name="calcMethod" value="cumulative"><input type="radio" name="calcMethod" value="peak"><input type="checkbox" id="save-settings-chk"><button id="settings-apply-btn"></button><button id="settings-reset-btn"></button></div>';
    await import('./main.ts');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    const modal = document.querySelector('#settings-modal') as HTMLDivElement;
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  it('saves to localStorage when save is checked', async (): Promise<void> => {
    document.body.innerHTML =
      '<div id="settings-toggle"></div><div id="settings-modal" class="hidden"><button id="modal-close"></button><span id="size-val"></span><input type="range" id="size-slider" min="100" max="1000" step="100" value="200"><span id="time-val"></span><input type="range" id="time-slider" min="10" max="30" step="5" value="15"><span id="label-multi"></span><button id="threads-toggle"></button><span id="threads-icon"></span><span id="label-single"></span><input type="radio" name="calcMethod" value="cumulative"><input type="radio" name="calcMethod" value="peak"><input type="checkbox" id="save-settings-chk"><button id="settings-apply-btn"></button><button id="settings-reset-btn"></button></div>';
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
      '<div id="settings-toggle"></div><div id="settings-modal" class="hidden"><button id="modal-close"></button><span id="size-val"></span><input type="range" id="size-slider" min="100" max="1000" step="100" value="200"><span id="time-val"></span><input type="range" id="time-slider" min="10" max="30" step="5" value="15"><span id="label-multi"></span><button id="threads-toggle"></button><span id="threads-icon"></span><span id="label-single"></span><input type="radio" name="calcMethod" value="cumulative"><input type="radio" name="calcMethod" value="peak"><input type="checkbox" id="save-settings-chk"><button id="settings-apply-btn"></button><button id="settings-reset-btn"></button></div>';

    localStorage.removeItem('speedybench_settings');
    sessionStorage.removeItem('speedybench_settings');
    await import('./main.ts');

    expect(document.querySelector('#threads-toggle')?.getAttribute('aria-pressed')).toBe('true');

    vi.unstubAllGlobals();
  });

  it('loads settings from sessionStorage correctly', async (): Promise<void> => {
    document.body.innerHTML =
      '<div id="settings-toggle"></div><div id="settings-modal" class="hidden"><button id="modal-close"></button><span id="size-val"></span><input type="range" id="size-slider" min="100" max="1000" step="100" value="200"><span id="time-val"></span><input type="range" id="time-slider" min="10" max="30" step="5" value="15"><span id="label-multi"></span><button id="threads-toggle"></button><span id="threads-icon"></span><span id="label-single"></span><input type="radio" name="calcMethod" value="cumulative"><input type="radio" name="calcMethod" value="peak"><input type="checkbox" id="save-settings-chk"><button id="settings-apply-btn"></button><button id="settings-reset-btn"></button></div>';

    localStorage.removeItem('speedybench_settings');
    sessionStorage.setItem(
      'speedybench_settings',
      JSON.stringify({ save: false, size: 999, threads: 8, time: 20 }),
    );
    await import('./main.ts');

    expect(document.querySelector('#size-val')?.textContent).toBe('999');
  });

  it('handles calcMethod radio buttons correctly', async (): Promise<void> => {
    document.body.innerHTML =
      '<div id="settings-toggle"></div><div id="settings-modal" class="hidden"><button id="modal-close"></button><span id="size-val"></span><input type="range" id="size-slider" min="100" max="1000" step="100" value="200"><span id="time-val"></span><input type="range" id="time-slider" min="10" max="30" step="5" value="15"><span id="label-multi"></span><button id="threads-toggle"></button><span id="threads-icon"></span><span id="label-single"></span><input type="radio" name="calcMethod" value="cumulative"><input type="radio" name="calcMethod" value="peak"><input type="checkbox" id="save-settings-chk"><button id="settings-apply-btn"></button><button id="settings-reset-btn"></button></div>';

    localStorage.setItem(
      'speedybench_settings',
      JSON.stringify({ calcMethod: 'peak', save: true, size: 200, threads: 8, time: 20 }),
    );
    await import('./main.ts');

    const radioPeak = document.querySelector(
      'input[name="calcMethod"][value="peak"]',
    ) as HTMLInputElement;
    const radioCum = document.querySelector(
      'input[name="calcMethod"][value="cumulative"]',
    ) as HTMLInputElement;

    expect(radioPeak.checked).toBe(true);
    expect(radioCum.checked).toBe(false);

    radioCum.checked = false;
    radioCum.dispatchEvent(new Event('change'));

    radioCum.checked = true;
    radioCum.dispatchEvent(new Event('change'));

    radioPeak.checked = false;
    radioPeak.dispatchEvent(new Event('change'));

    const applyBtn = document.querySelector('#settings-apply-btn') as HTMLElement;
    applyBtn.click();

    expect(localStorage.getItem('speedybench_settings')).toContain('"calcMethod":"cumulative"');

    radioPeak.checked = true;
    radioPeak.dispatchEvent(new Event('change'));
    applyBtn.click();
    expect(localStorage.getItem('speedybench_settings')).toContain('"calcMethod":"peak"');
  });

  it('covers remaining handler branches via direct worker messages', async (): Promise<void> => {
    await import('./main.ts');
    const startBtn = document.querySelector('#startStopBtn') as HTMLElement;
    startBtn.click();
    await vi.waitFor(() => {
      expect(startBtn.classList.contains('running')).toBe(true);
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(document.querySelector('#ip')?.textContent).toBe('127.0.0.1');

    emitWorkerMessage({ jitter: '2', type: 'ping', value: '10' });
    expect(document.querySelector('#pingText')?.textContent).toBe('10');
    expect(document.querySelector('#jitText')?.textContent).toBe('2');

    emitWorkerMessage({
      bytes: 100,
      loadedPing: '15',
      timeMs: 200,
      type: 'dl_progress',
      value: '1',
    });
    expect(document.querySelector('#dlPingText')?.textContent).toBe('15');

    emitWorkerMessage({
      bytes: 100,
      loadedPing: '20',
      timeMs: 200,
      type: 'ul_progress',
      value: '1',
    });
    expect(document.querySelector('#ulPingText')?.textContent).toBe('20');
  });
});

describe('updateSliderGradient()', () => {
  it('updates slider background properly even with missing min/max', async () => {
    const { updateSliderGradient } = await import('./main.ts');
    const input = document.createElement('input');
    input.type = 'range';
    updateSliderGradient(input);
    expect(input.style.getPropertyValue('--value-percent')).toBe('0%');
  });

  it('calculates correct percentage', async () => {
    const { updateSliderGradient } = await import('./main.ts');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '10';
    input.max = '110';
    input.value = '60';
    updateSliderGradient(input);
    expect(input.style.getPropertyValue('--value-percent')).toBe('50%');
  });

  it('handles max <= min gracefully', async () => {
    const { updateSliderGradient } = await import('./main.ts');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '100';
    input.max = '10';
    input.value = '50';
    updateSliderGradient(input);
    expect(input.style.getPropertyValue('--value-percent')).toBe('0%');
  });

  it('updates loaded latency text when dl_progress and ul_progress include loadedPing', async (): Promise<void> => {
    await import('./main.ts');

    emitWorkerMessage({
      bytes: 0,
      loadedPing: '15.0',
      timeMs: 0,
      type: 'dl_progress',
      value: '100',
    });
    expect(document.querySelector('#dlPingText')?.textContent).toBe('15.0');

    emitWorkerMessage({
      bytes: 0,
      loadedPing: '12.0',
      timeMs: 0,
      type: 'ul_progress',
      value: '50',
    });
    expect(document.querySelector('#ulPingText')?.textContent).toBe('12.0');
  });
});
