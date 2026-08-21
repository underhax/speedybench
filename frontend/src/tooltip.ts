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

export function formatIdlePingStats(min: string, avg: string, max: string): string[] | null {
  if (!min || !avg || !max) {
    return null;
  }
  const ms = localize('unit_ms');
  return [
    `${localize('min')}: ${min} ${ms}`,
    `${localize('avg')}: ${avg} ${ms}`,
    `${localize('max')}: ${max} ${ms}`,
  ];
}

export function formatDeltaPing(loadedPingStr: string, idlePingStr: string): string | null {
  const loaded = Number.parseFloat(loadedPingStr);
  const idle = Number.parseFloat(idlePingStr);
  if (Number.isNaN(loaded) || Number.isNaN(idle) || loaded <= 0 || idle <= 0) {
    return null;
  }
  const delta = loaded - idle;
  const rounded = Number.parseFloat(delta.toFixed(1));
  if (rounded === 0) {
    return null;
  }
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)} ${localize('unit_ms')}`;
}

export function setupStatTooltip(
  el: HTMLElement,
  getContent: () => { title: string; extra?: string | string[] | null },
): () => void {
  const tooltip = document.createElement('div');
  tooltip.className = 'stat-tooltip';
  const titleEl = document.createElement('div');
  const extraEl = document.createElement('div');
  tooltip.appendChild(titleEl);
  tooltip.appendChild(extraEl);
  el.appendChild(tooltip);

  const update = (): void => {
    const { title, extra } = getContent();
    titleEl.textContent = title;
    if (extra) {
      extraEl.textContent = '';
      if (Array.isArray(extra)) {
        for (const item of extra) {
          const row = document.createElement('div');
          row.textContent = item;
          extraEl.appendChild(row);
        }
      } else {
        extraEl.textContent = extra;
      }
      extraEl.style.display = '';
    } else {
      extraEl.textContent = '';
      extraEl.style.display = 'none';
    }
  };

  const onEnter = (): void => {
    update();
    tooltip.classList.add('visible');
  };

  const onLeave = (): void => {
    tooltip.classList.remove('visible');
  };

  el.addEventListener('mouseenter', onEnter);
  el.addEventListener('mouseleave', onLeave);

  return (): void => {
    el.removeEventListener('mouseenter', onEnter);
    el.removeEventListener('mouseleave', onLeave);
    tooltip.remove();
  };
}
