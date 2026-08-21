import './setup.ts';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import { localize } from './localize.ts';
import { formatBytes, formatTime, setupSpeedtest, updateMetric } from './speedtest.ts';

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

describe('Speedtest', () => {
  let fetchMock: Mock;

  beforeEach((): void => {
    localStorage.clear();
    sessionStorage.clear();
    mockWorkerInstance.onmessage = null;
    mockWorkerInstance.postMessage.mockClear();
    mockWorkerInstance.terminate.mockClear();
    vi.stubGlobal('Worker', MockWorker);

    document.body.innerHTML = `
      <div id="startStopBtn"></div>
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
      <div id="stat-ping"></div>
      <div id="stat-dl-ping"></div>
      <div id="stat-ul-ping"></div>
      <div id="stat-jitter"></div>
    `;

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

  it('formats bytes and time correctly', (): void => {
    expect(formatBytes(0)).toBe(`0.0 ${localize('unit_mb')}`);
    expect(formatBytes(1048576)).toBe(`1.0 ${localize('unit_mb')}`);
    expect(formatTime(1500)).toBe(`1.5 ${localize('settings_sec')}`);
  });

  it('updates metrics and subtext correctly', (): void => {
    updateMetric('#dlText', '#dlSubText', '100', 1048576, 1000);
    expect(document.querySelector('#dlText')?.textContent).toBe('100');
    expect(document.querySelector('#dlSubText')?.textContent).toContain('1.0 MB / 1.0 s');

    updateMetric('#nonExistent', '#nonExistentSub', '100');
  });

  it('handles start, worker messaging, and stop button clicks', async (): Promise<void> => {
    const controller = setupSpeedtest();
    const startBtn = document.querySelector('#startStopBtn') as HTMLElement;

    startBtn.click();
    await vi.waitFor(() => {
      expect(mockWorkerInstance.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          base: window.location.href,
          debug: false,
          type: 'start',
        }),
      );
    });

    expect(fetchMock).toHaveBeenCalledWith(new URL('./api/ip', window.location.href));
    await new Promise((r) => setTimeout(r, 10));
    expect(document.querySelector('#ip')?.textContent).toBe('127.0.0.1');

    emitWorkerMessage({ jitter: '2', type: 'ping', value: '10' });
    expect(document.querySelector('#pingText')?.textContent).toBe('10');
    expect(document.querySelector('#jitText')?.textContent).toBe('2');

    emitWorkerMessage({ bytes: 0, timeMs: 0, type: 'dl_progress', value: '100' });
    expect(document.querySelector('#dlText')?.textContent).toBe('100');

    emitWorkerMessage({
      bytes: 1048576,
      chartSamples: [{ bytes: 1048576, speed: 100, timeMs: 1000 }],
      samples: [{ bytes: 1048576, speed: 100, timeMs: 1000 }],
      timeMs: 1000,
      type: 'dl_done',
      value: '100',
    });
    expect(controller.getDlDetails().finalSpeed).toBe('100');
    expect(controller.getDlDetails().samples.length).toBe(1);

    emitWorkerMessage({ bytes: 0, timeMs: 0, type: 'ul_progress', value: '50' });
    expect(document.querySelector('#ulText')?.textContent).toBe('50');

    emitWorkerMessage({
      bytes: 524288,
      chartSamples: [{ bytes: 524288, speed: 50, timeMs: 500 }],
      samples: [{ bytes: 524288, speed: 50, timeMs: 500 }],
      timeMs: 500,
      type: 'ul_done',
      value: '50',
    });
    expect(controller.getUlDetails().finalSpeed).toBe('50');

    emitWorkerMessage({ type: 'status', value: 'done' });
    expect(startBtn.classList.contains('running')).toBe(false);
    expect(startBtn.classList.contains('done')).toBe(true);
    expect(mockWorkerInstance.terminate).toHaveBeenCalled();

    startBtn.click();
    expect(startBtn.classList.contains('running')).toBe(true);

    startBtn.click();
    expect(startBtn.classList.contains('running')).toBe(false);
  });

  it('handles empty progress and done messages without crashing', async (): Promise<void> => {
    setupSpeedtest();
    const startBtn = document.querySelector('#startStopBtn') as HTMLElement;
    startBtn.click();
    await vi.waitFor(() => {
      expect(startBtn.classList.contains('running')).toBe(true);
    });

    emitWorkerMessage({ bytes: 0, timeMs: 0, type: 'dl_progress', value: '0.00' });
    emitWorkerMessage({ bytes: 0, timeMs: 0, type: 'dl_done', value: '0.00' });
    emitWorkerMessage({ bytes: 0, timeMs: 0, type: 'ul_progress', value: '0.00' });
    emitWorkerMessage({ bytes: 0, timeMs: 0, type: 'ul_done', value: '0.00' });
    expect(startBtn.classList.contains('running')).toBe(true);
  });

  it('handles missing DOM elements gracefully', async (): Promise<void> => {
    document.body.innerHTML = '';
    const startBtn = document.createElement('div');
    startBtn.id = 'startStopBtn';
    document.body.appendChild(startBtn);

    setupSpeedtest();
    startBtn.click();

    emitWorkerMessage({ jitter: '2', type: 'ping', value: '10' });
    emitWorkerMessage({ type: 'dl_progress', value: '100' });
    emitWorkerMessage({ type: 'ul_progress', value: '50' });

    startBtn.click();
    emitWorkerMessage({ type: 'status', value: 'done' });
    await new Promise((r) => setTimeout(r, 10));
    expect(startBtn.classList.contains('running')).toBe(false);
  });

  it('handles fetch IP error gracefully', async (): Promise<void> => {
    fetchMock.mockImplementation((url: URL | string) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/ip')) {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve({
        json: () => Promise.resolve({ debug: false }),
        ok: true,
        text: () => Promise.resolve('127.0.0.1'),
      });
    });
    setupSpeedtest();

    const startBtn = document.querySelector('#startStopBtn') as HTMLElement;
    startBtn.click();
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(new URL('./api/ip', window.location.href));
    });
    await new Promise((r) => setTimeout(r, 10));
  });

  it('updates loaded latency and stat tooltips on worker progress messages', async (): Promise<void> => {
    setupSpeedtest();
    const startBtn = document.querySelector('#startStopBtn') as HTMLElement;
    startBtn.click();
    await vi.waitFor(() => {
      expect(mockWorkerInstance.postMessage).toHaveBeenCalled();
    });

    const pingStat = document.querySelector('#stat-ping') as HTMLElement;
    const dlPingStat = document.querySelector('#stat-dl-ping') as HTMLElement;
    const ulPingStat = document.querySelector('#stat-ul-ping') as HTMLElement;
    const jitterStat = document.querySelector('#stat-jitter') as HTMLElement;

    pingStat.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(pingStat.querySelector('.stat-tooltip')?.textContent).toBe(localize('idle_ping'));

    emitWorkerMessage({
      avgPing: '18.4',
      jitter: '2.1',
      maxPing: '24.1',
      minPing: '15.2',
      type: 'ping',
      value: '15.2',
    });

    pingStat.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(pingStat.querySelector('.stat-tooltip')?.textContent).toContain('Min: 15.2 ms');

    jitterStat.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(jitterStat.querySelector('.stat-tooltip')?.textContent).toBe(localize('jitter'));

    emitWorkerMessage({
      bytes: 1000,
      loadedPing: '25.8',
      timeMs: 500,
      type: 'dl_progress',
      value: '100',
    });
    expect(document.querySelector('#dlPingText')?.textContent).toBe('25.8');
    dlPingStat.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(dlPingStat.querySelector('.stat-tooltip')?.textContent).toContain('+10.6 ms');

    emitWorkerMessage({
      bytes: 1000,
      loadedPing: '10.2',
      timeMs: 500,
      type: 'ul_progress',
      value: '80',
    });
    expect(document.querySelector('#ulPingText')?.textContent).toBe('10.2');
    ulPingStat.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(ulPingStat.querySelector('.stat-tooltip')?.textContent).toContain('-5.0 ms');

    const dlChart = document.querySelector('#dlChart') as SVGSVGElement;
    const dlHitArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    dlHitArea.setAttribute('class', 'chart-hit-area');
    dlChart?.appendChild(dlHitArea);
    dlHitArea.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));

    const ulChart = document.querySelector('#ulChart') as SVGSVGElement;
    const ulHitArea = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    ulHitArea.setAttribute('class', 'chart-hit-area');
    ulChart?.appendChild(ulHitArea);
    ulHitArea.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
  });

  it('covers non-done status message and programmatic stopTest', (): void => {
    const controller = setupSpeedtest();
    emitWorkerMessage({ type: 'status', value: 'running' });
    expect(controller.stopTest).toBeDefined();
    controller.stopTest();
  });

  it('handles IP fetch success when IP DOM element is missing', async (): Promise<void> => {
    document.querySelector('#ip')?.remove();
    setupSpeedtest();

    const startBtn = document.querySelector('#startStopBtn') as HTMLElement;
    startBtn.click();
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    await new Promise((r) => setTimeout(r, 10));
    expect(document.querySelector('#startStopBtn')).not.toBeNull();
  });

  it('handles all worker messages when progress DOM elements and sample arrays are missing', async (): Promise<void> => {
    document.body.innerHTML = '<div id="startStopBtn"></div>';
    setupSpeedtest();

    const startBtn = document.querySelector('#startStopBtn') as HTMLElement;
    startBtn.click();
    await vi.waitFor(() => {
      expect(mockWorkerInstance.postMessage).toHaveBeenCalled();
    });

    emitWorkerMessage({ jitter: '1', type: 'ping', value: '5' });
    emitWorkerMessage({
      bytes: 100,
      loadedPing: '10',
      timeMs: 100,
      type: 'dl_progress',
      value: '20',
    });
    emitWorkerMessage({
      bytes: 100,
      loadedPing: '10',
      timeMs: 100,
      type: 'dl_done',
      value: '20',
    });
    emitWorkerMessage({
      bytes: 100,
      loadedPing: '12',
      timeMs: 100,
      type: 'ul_progress',
      value: '10',
    });
    emitWorkerMessage({
      bytes: 100,
      loadedPing: '12',
      timeMs: 100,
      type: 'ul_done',
      value: '10',
    });
    emitWorkerMessage({ type: 'status', value: 'downloading' });
    emitWorkerMessage({ type: 'status', value: 'done' });

    expect(startBtn.classList.contains('running')).toBe(false);
  });

  it('uses samples fallback when chartSamples is undefined in progress', async (): Promise<void> => {
    setupSpeedtest();
    const startBtn = document.querySelector('#startStopBtn') as HTMLElement;
    startBtn.click();
    await vi.waitFor(() => {
      expect(mockWorkerInstance.postMessage).toHaveBeenCalled();
    });

    const mockSamples = [{ bytes: 100, speed: 50, timeMs: 100 }];
    emitWorkerMessage({
      bytes: 100,
      samples: mockSamples,
      timeMs: 100,
      type: 'dl_progress',
      value: '50',
    });
    expect(document.querySelector('#dlChart')?.innerHTML).toContain('<path');

    emitWorkerMessage({
      bytes: 100,
      samples: mockSamples,
      timeMs: 100,
      type: 'ul_progress',
      value: '30',
    });
    expect(document.querySelector('#ulChart')?.innerHTML).toContain('<path');
  });
});
