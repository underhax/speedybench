import { debugLog } from './debug.ts';
import { localize } from './localize.ts';

interface SampleObj {
  speed: number;
  bytes: number;
  timeMs: number;
}

export function setupChartTooltip(
  testArea: HTMLElement,
  svgEl: SVGSVGElement,
  getSamples: () => SampleObj[],
  colorVar: string = '--dl-color',
): void {
  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  const speedEl = document.createElement('div');
  const timeEl = document.createElement('div');
  tooltip.appendChild(speedEl);
  tooltip.appendChild(timeEl);
  testArea.appendChild(tooltip);

  const highlight = document.createElement('div');
  highlight.className = 'chart-highlight';
  highlight.setAttribute('data-color', colorVar);
  testArea.appendChild(highlight);

  let cachedSvgRect: DOMRect | null = null;
  let cachedAreaRect: DOMRect | null = null;

  function moveHighlight(svgX: number, svgY: number): void {
    if (!cachedSvgRect || !cachedAreaRect) return;
    const pixelX = cachedSvgRect.left - cachedAreaRect.left + (svgX / 1000) * cachedSvgRect.width;
    const pixelY = cachedSvgRect.top - cachedAreaRect.top + (svgY / 100) * cachedSvgRect.height;
    highlight.style.transform = `translate(${pixelX}px, ${pixelY}px)`;
    highlight.classList.add('visible');
  }

  function hideHighlight(): void {
    highlight.classList.remove('visible');
  }

  function onLeave(): void {
    tooltip.classList.remove('visible');
    cachedSvgRect = null;
    cachedAreaRect = null;
    hideHighlight();
  }

  function onMove(e: MouseEvent): void {
    const target = e.target as Element | null;
    if (!target?.classList?.contains('chart-hit-area')) {
      onLeave();
      return;
    }

    const rawSamples = getSamples();
    if (rawSamples.length === 0) return;

    const samples: SampleObj[] = [{ bytes: 0, speed: 0, timeMs: 0 }, ...rawSamples];

    if (!cachedSvgRect || !cachedAreaRect) {
      cachedSvgRect = svgEl.getBoundingClientRect();
      cachedAreaRect = testArea.getBoundingClientRect();
    }

    tooltip.classList.add('visible');

    const relX = e.clientX - cachedSvgRect.left;
    const ratio = Math.max(0, Math.min(1, relX / cachedSvgRect.width));
    const index = Math.round(ratio * (samples.length - 1));
    const sample = samples[index];
    if (!sample) return;

    const dotX = (index / (samples.length - 1)) * 1000;
    const dataMax = Math.max(...samples.map((s) => s.speed), 1);
    const dotY = 100 - (sample.speed / dataMax) * 100;
    moveHighlight(dotX, dotY);

    debugLog('selected chart sample', sample);
    speedEl.textContent = `${sample.speed.toFixed(2)} ${localize('unit_mbps')}`;
    timeEl.textContent = `${sample.timeMs.toFixed(0)} ${localize('unit_ms')}`;

    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;
    const caretSize = 8;
    const gap = 2;
    const cursorXInArea = e.clientX - cachedAreaRect.left;
    const cursorYInArea = e.clientY - cachedAreaRect.top;

    const x = cursorXInArea - tooltipWidth / 2;
    const y = cursorYInArea - tooltipHeight - caretSize - gap;

    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }

  svgEl.addEventListener('mousemove', onMove as EventListener);
  svgEl.addEventListener('mouseleave', onLeave);
  testArea.addEventListener('mouseleave', onLeave);
}
