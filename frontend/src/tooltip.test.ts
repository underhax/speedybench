import './setup.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setDebugEnabled } from './debug.ts';
import {
  formatDeltaPing,
  formatIdlePingStats,
  setupChartTooltip,
  setupStatTooltip,
} from './tooltip.ts';

type SampleObj = { speed: number; bytes: number; timeMs: number };

function createTestArea(): { svgEl: SVGSVGElement; testArea: HTMLElement } {
  const testArea = document.createElement('div');
  testArea.className = 'testArea';
  testArea.style.position = 'relative';
  testArea.style.width = '400px';
  testArea.style.height = '160px';

  const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgEl.setAttribute('id', 'testChart');
  testArea.appendChild(svgEl);
  document.body.appendChild(testArea);

  return { svgEl, testArea };
}

function addHitArea(svgEl: SVGSVGElement): SVGPathElement {
  const hitArea = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  hitArea.setAttribute('class', 'chart-hit-area');
  hitArea.setAttribute('d', 'M 0,50 L 400,50');
  svgEl.appendChild(hitArea);
  return hitArea;
}

function mockBoundingClientRect(el: Element, rect: Partial<DOMRect>): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    bottom: 0,
    height: 0,
    left: 0,
    right: 0,
    toJSON: () => ({}),
    top: 0,
    width: 0,
    x: 0,
    y: 0,
    ...rect,
  });
}

describe('setupChartTooltip()', () => {
  let testArea: HTMLElement;
  let svgEl: SVGSVGElement;

  beforeEach((): void => {
    document.body.innerHTML = '';
    ({ svgEl, testArea } = createTestArea());
  });

  afterEach((): void => {
    setDebugEnabled(false);
    vi.restoreAllMocks();
  });

  it('creates a tooltip div inside testArea', (): void => {
    setupChartTooltip(testArea, svgEl, () => []);
    const tooltip = testArea.querySelector('.chart-tooltip');
    expect(tooltip).not.toBeNull();
  });

  it('configures highlight element with custom color variable', (): void => {
    setupChartTooltip(testArea, svgEl, () => [], '--ul-color');
    const highlight = testArea.querySelector('.chart-highlight');
    expect(highlight?.getAttribute('data-color')).toBe('--ul-color');
  });

  it('does not show tooltip when samples array is empty', (): void => {
    setupChartTooltip(testArea, svgEl, () => []);
    const hitArea = addHitArea(svgEl);
    hitArea.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    const tooltip = testArea.querySelector('.chart-tooltip') as HTMLElement;
    expect(tooltip.classList.contains('visible')).toBe(false);
  });

  it('shows tooltip on mousemove over hit-area when samples exist', (): void => {
    const samples: SampleObj[] = [
      { bytes: 1000, speed: 50.12, timeMs: 250 },
      { bytes: 2000, speed: 75.34, timeMs: 500 },
    ];
    setupChartTooltip(testArea, svgEl, () => samples);
    const hitArea = addHitArea(svgEl);
    mockBoundingClientRect(svgEl, { left: 0, width: 400 });
    mockBoundingClientRect(testArea, { height: 160, left: 0, top: 0, width: 400 });

    hitArea.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 200, clientY: 80 }),
    );
    const tooltip = testArea.querySelector('.chart-tooltip') as HTMLElement;
    expect(tooltip.classList.contains('visible')).toBe(true);
  });

  it('reuses cached bounding rects on consecutive mousemove events', (): void => {
    const samples: SampleObj[] = [{ bytes: 1000, speed: 50.12, timeMs: 250 }];
    setupChartTooltip(testArea, svgEl, () => samples);
    const hitArea = addHitArea(svgEl);
    mockBoundingClientRect(svgEl, { left: 0, width: 400 });
    mockBoundingClientRect(testArea, { height: 160, left: 0, top: 0, width: 400 });

    hitArea.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 100, clientY: 80 }),
    );
    hitArea.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 200, clientY: 80 }),
    );
    const tooltip = testArea.querySelector('.chart-tooltip') as HTMLElement;
    expect(tooltip.classList.contains('visible')).toBe(true);
  });

  it('handles missing sample at calculated index safely', (): void => {
    const sparseSamples: SampleObj[] = [undefined as unknown as SampleObj];
    setupChartTooltip(testArea, svgEl, () => sparseSamples);
    const hitArea = addHitArea(svgEl);
    mockBoundingClientRect(svgEl, { left: 0, width: 400 });
    mockBoundingClientRect(testArea, { height: 160, left: 0, top: 0, width: 400 });

    hitArea.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 400, clientY: 80 }),
    );
    const tooltip = testArea.querySelector('.chart-tooltip') as HTMLElement;
    expect(tooltip.classList.contains('visible')).toBe(true);
  });

  it('safely aborts moveHighlight when cache is invalidated during calculation', (): void => {
    const sampleWithSideEffect = {
      bytes: 1000,
      get speed(): number {
        testArea.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
        return 50;
      },
      timeMs: 250,
    };
    setupChartTooltip(testArea, svgEl, () => [sampleWithSideEffect]);
    const hitArea = addHitArea(svgEl);
    mockBoundingClientRect(svgEl, { left: 0, width: 400 });
    mockBoundingClientRect(testArea, { height: 160, left: 0, top: 0, width: 400 });

    expect((): void => {
      hitArea.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 200, clientY: 80 }),
      );
    }).toThrow();

    const highlight = testArea.querySelector('.chart-highlight') as HTMLElement;
    expect(highlight.classList.contains('visible')).toBe(false);
  });

  it('hides tooltip when mouse moves outside hit area', (): void => {
    const samples: SampleObj[] = [{ bytes: 1000, speed: 50.12, timeMs: 250 }];
    setupChartTooltip(testArea, svgEl, () => samples);
    const hitArea = addHitArea(svgEl);
    mockBoundingClientRect(svgEl, { left: 0, width: 400 });
    mockBoundingClientRect(testArea, { height: 160, left: 0, top: 0, width: 400 });

    hitArea.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 200, clientY: 80 }),
    );
    const tooltip = testArea.querySelector('.chart-tooltip') as HTMLElement;
    expect(tooltip.classList.contains('visible')).toBe(true);

    svgEl.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 200, clientY: 10 }));
    expect(tooltip.classList.contains('visible')).toBe(false);
  });

  it('hides tooltip on mouseleave from svg element', (): void => {
    const samples: SampleObj[] = [{ bytes: 1000, speed: 50.12, timeMs: 250 }];
    setupChartTooltip(testArea, svgEl, () => samples);
    const hitArea = addHitArea(svgEl);
    mockBoundingClientRect(svgEl, { left: 0, width: 400 });
    mockBoundingClientRect(testArea, { height: 160, left: 0, top: 0, width: 400 });

    hitArea.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 200, clientY: 80 }),
    );
    const tooltip = testArea.querySelector('.chart-tooltip') as HTMLElement;
    expect(tooltip.classList.contains('visible')).toBe(true);

    svgEl.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(tooltip.classList.contains('visible')).toBe(false);
  });

  it('hides tooltip on mouseleave from testArea', (): void => {
    const samples: SampleObj[] = [{ bytes: 1000, speed: 50.12, timeMs: 250 }];
    setupChartTooltip(testArea, svgEl, () => samples);
    const hitArea = addHitArea(svgEl);
    mockBoundingClientRect(svgEl, { left: 0, width: 400 });
    mockBoundingClientRect(testArea, { height: 160, left: 0, top: 0, width: 400 });

    hitArea.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 200, clientY: 80 }),
    );
    testArea.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    const tooltip = testArea.querySelector('.chart-tooltip') as HTMLElement;
    expect(tooltip.classList.contains('visible')).toBe(false);
  });

  it('displays 0 Mbps and 0 ms when cursor is at the left edge', (): void => {
    const samples: SampleObj[] = [
      { bytes: 500, speed: 10.0, timeMs: 250 },
      { bytes: 5000, speed: 90.0, timeMs: 5000 },
    ];
    setupChartTooltip(testArea, svgEl, () => samples);
    const hitArea = addHitArea(svgEl);
    mockBoundingClientRect(svgEl, { left: 0, width: 400 });
    mockBoundingClientRect(testArea, { height: 160, left: 0, top: 0, width: 400 });

    hitArea.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 0, clientY: 80 }));

    const tooltip = testArea.querySelector('.chart-tooltip') as HTMLElement;
    expect(tooltip.textContent).toContain('0.00');
    expect(tooltip.textContent).toContain('0');
  });

  it('logs the selected sample when debug logging is enabled', (): void => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const samples: SampleObj[] = [{ bytes: 1000, speed: 20, timeMs: 500 }];
    setDebugEnabled(true);
    setupChartTooltip(testArea, svgEl, () => samples);
    const hitArea = addHitArea(svgEl);
    mockBoundingClientRect(svgEl, { left: 0, width: 400 });
    mockBoundingClientRect(testArea, { height: 160, left: 0, top: 0, width: 400 });

    hitArea.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 200, clientY: 80 }),
    );

    expect(debugSpy).toHaveBeenCalledWith('[speedybench]', 'selected chart sample', {
      bytes: 1000,
      speed: 20,
      timeMs: 500,
    });
    setDebugEnabled(false);
  });

  it('updates tooltip content with sample at corresponding position', (): void => {
    const samples: SampleObj[] = [
      { bytes: 500, speed: 10.0, timeMs: 250 },
      { bytes: 1000, speed: 20.0, timeMs: 500 },
      { bytes: 1500, speed: 30.0, timeMs: 750 },
      { bytes: 2000, speed: 40.0, timeMs: 1000 },
    ];
    setupChartTooltip(testArea, svgEl, () => samples);
    const hitArea = addHitArea(svgEl);
    mockBoundingClientRect(svgEl, { left: 0, width: 400 });
    mockBoundingClientRect(testArea, { height: 160, left: 0, top: 0, width: 400 });

    hitArea.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 400, clientY: 80 }),
    );

    const tooltip = testArea.querySelector('.chart-tooltip') as HTMLElement;
    expect(tooltip.textContent).toContain('40.00');
    expect(tooltip.textContent).toContain('1000');
  });

  it('clamps index when cursor is beyond SVG bounds', (): void => {
    const samples: SampleObj[] = [
      { bytes: 500, speed: 10.0, timeMs: 250 },
      { bytes: 5000, speed: 90.0, timeMs: 5000 },
    ];
    setupChartTooltip(testArea, svgEl, () => samples);
    const hitArea = addHitArea(svgEl);
    mockBoundingClientRect(svgEl, { left: 100, width: 200 });
    mockBoundingClientRect(testArea, { height: 160, left: 0, top: 0, width: 400 });

    hitArea.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 500, clientY: 80 }),
    );

    const tooltip = testArea.querySelector('.chart-tooltip') as HTMLElement;
    expect(tooltip.textContent).toContain('90.00');
  });

  it('does not update tooltip when samples become empty during mousemove', (): void => {
    let samples: SampleObj[] = [{ bytes: 1000, speed: 50.0, timeMs: 250 }];
    setupChartTooltip(testArea, svgEl, () => samples);
    const hitArea = addHitArea(svgEl);
    mockBoundingClientRect(svgEl, { left: 0, width: 400 });
    mockBoundingClientRect(testArea, { height: 160, left: 0, top: 0, width: 400 });

    hitArea.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 200, clientY: 80 }),
    );
    const tooltip = testArea.querySelector('.chart-tooltip') as HTMLElement;
    expect(tooltip.textContent).toContain('50.00');

    samples = [];
    hitArea.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 200, clientY: 80 }),
    );
    expect(tooltip.textContent).toContain('50.00');
  });

  it('centers tooltip horizontally over the cursor and positions above', (): void => {
    const samples: SampleObj[] = [
      { bytes: 1000, speed: 50.0, timeMs: 250 },
      { bytes: 2000, speed: 80.0, timeMs: 500 },
    ];
    setupChartTooltip(testArea, svgEl, () => samples);
    const hitArea = addHitArea(svgEl);
    mockBoundingClientRect(svgEl, { left: 0, width: 400 });
    mockBoundingClientRect(testArea, { height: 160, left: 0, top: 0, width: 400 });

    const tooltip = testArea.querySelector('.chart-tooltip') as HTMLElement;
    Object.defineProperty(tooltip, 'offsetHeight', { configurable: true, value: 40 });
    Object.defineProperty(tooltip, 'offsetWidth', { configurable: true, value: 80 });

    hitArea.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 200, clientY: 100 }),
    );

    expect(Number.parseFloat(tooltip.style.left)).toBe(160);
    expect(Number.parseFloat(tooltip.style.top)).toBe(50);
  });

  it('centers tooltip at the left edge correctly', (): void => {
    const samples: SampleObj[] = [
      { bytes: 1000, speed: 50.0, timeMs: 250 },
      { bytes: 2000, speed: 80.0, timeMs: 500 },
    ];
    setupChartTooltip(testArea, svgEl, () => samples);
    const hitArea = addHitArea(svgEl);
    mockBoundingClientRect(svgEl, { left: 0, width: 400 });
    mockBoundingClientRect(testArea, { height: 160, left: 0, top: 0, width: 400 });

    const tooltip = testArea.querySelector('.chart-tooltip') as HTMLElement;
    Object.defineProperty(tooltip, 'offsetHeight', { configurable: true, value: 40 });
    Object.defineProperty(tooltip, 'offsetWidth', { configurable: true, value: 80 });

    hitArea.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 0, clientY: 100 }));

    expect(Number.parseFloat(tooltip.style.left)).toBe(-40);
  });
});

describe('formatIdlePingStats()', () => {
  it('returns null when any argument is empty', () => {
    expect(formatIdlePingStats('', '15.0', '20.0')).toBeNull();
    expect(formatIdlePingStats('10.0', '', '20.0')).toBeNull();
    expect(formatIdlePingStats('10.0', '15.0', '')).toBeNull();
  });

  it('formats idle ping statistics as an array with localized labels and units on each line', () => {
    const result = formatIdlePingStats('12.3', '15.6', '24.8');
    expect(result).toEqual(['Min: 12.3 ms', 'Avg: 15.6 ms', 'Max: 24.8 ms']);
  });
});

describe('formatDeltaPing()', () => {
  it('returns null when inputs are invalid or non-positive', () => {
    expect(formatDeltaPing('', '10.0')).toBeNull();
    expect(formatDeltaPing('20.0', '')).toBeNull();
    expect(formatDeltaPing('abc', '10.0')).toBeNull();
    expect(formatDeltaPing('0', '10.0')).toBeNull();
    expect(formatDeltaPing('20.0', '0')).toBeNull();
  });

  it('returns null when delta rounds to zero', () => {
    expect(formatDeltaPing('15.02', '15.04')).toBeNull();
  });

  it('formats positive delta with plus sign', () => {
    expect(formatDeltaPing('25.8', '15.2')).toBe('+10.6 ms');
  });

  it('formats negative delta with minus sign', () => {
    expect(formatDeltaPing('10.2', '15.2')).toBe('-5.0 ms');
  });
});

describe('setupStatTooltip()', () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    container.id = 'test-stat';
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('creates stat-tooltip element inside target', () => {
    setupStatTooltip(container, () => ({ title: 'Test Title' }));
    const tooltip = container.querySelector('.stat-tooltip');
    expect(tooltip).not.toBeNull();
  });

  it('shows tooltip on mouseenter with title only when extra is absent', () => {
    setupStatTooltip(container, () => ({ title: 'Idle Latency' }));
    const tooltip = container.querySelector('.stat-tooltip') as HTMLElement;
    expect(tooltip.classList.contains('visible')).toBe(false);

    container.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(tooltip.classList.contains('visible')).toBe(true);
    expect(tooltip.textContent).toBe('Idle Latency');
  });

  it('displays extra line when string extra info is provided', () => {
    setupStatTooltip(container, () => ({
      extra: '+10.5 ms',
      title: 'Download Latency',
    }));
    const tooltip = container.querySelector('.stat-tooltip') as HTMLElement;

    container.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(tooltip.classList.contains('visible')).toBe(true);
    expect(tooltip.textContent).toContain('Download Latency');
    expect(tooltip.textContent).toContain('+10.5 ms');
  });

  it('displays multiple rows when array extra info is provided', () => {
    setupStatTooltip(container, () => ({
      extra: ['Min: 10.0 ms', 'Avg: 15.0 ms', 'Max: 20.0 ms'],
      title: 'Idle Latency',
    }));
    const tooltip = container.querySelector('.stat-tooltip') as HTMLElement;

    container.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(tooltip.classList.contains('visible')).toBe(true);
    expect(tooltip.textContent).toContain('Idle Latency');
    expect(tooltip.textContent).toContain('Min: 10.0 ms');
    expect(tooltip.textContent).toContain('Avg: 15.0 ms');
    expect(tooltip.textContent).toContain('Max: 20.0 ms');
  });

  it('hides extra line dynamically when extra becomes null', () => {
    let extraValue: string | null = '+10.5 ms';
    setupStatTooltip(container, () => ({
      extra: extraValue,
      title: 'Download Latency',
    }));
    const tooltip = container.querySelector('.stat-tooltip') as HTMLElement;

    container.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(tooltip.textContent).toContain('+10.5 ms');

    extraValue = null;
    container.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(tooltip.textContent).toBe('Download Latency');
  });

  it('hides tooltip on mouseleave', () => {
    setupStatTooltip(container, () => ({ title: 'Idle Latency' }));
    const tooltip = container.querySelector('.stat-tooltip') as HTMLElement;

    container.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    expect(tooltip.classList.contains('visible')).toBe(true);

    container.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    expect(tooltip.classList.contains('visible')).toBe(false);
  });

  it('removes event listeners and tooltip element on cleanup', () => {
    const cleanup = setupStatTooltip(container, () => ({ title: 'Idle Latency' }));
    expect(container.querySelector('.stat-tooltip')).not.toBeNull();

    cleanup();
    expect(container.querySelector('.stat-tooltip')).toBeNull();
  });
});
