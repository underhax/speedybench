import '../setup.ts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localize } from '../localize.ts';
import { currentSettings } from '../settings.ts';
import { type DetailsData, setupDetailsModal } from './details.ts';

describe('setupDetailsModal()', () => {
  let dlData: DetailsData;
  let ulData: DetailsData;

  beforeEach((): void => {
    vi.useRealTimers();
    currentSettings.calcMethod = 'peak';
    dlData = {
      finalSpeed: '100.5',
      samples: [{ bytes: 1048576, speed: 100.5, timeMs: 1000 }],
    };
    ulData = {
      finalSpeed: '50.2',
      samples: [{ bytes: 524288, speed: 50.2, timeMs: 500 }],
    };

    document.body.innerHTML = `
      <button id="dl-info-btn"></button>
      <button id="ul-info-btn"></button>
      <div id="details-modal" class="hidden">
        <h3 id="details-title"></h3>
        <button id="details-close"></button>
        <button id="details-copy-btn">
          <span id="details-copy-icon"></span>
        </button>
        <table>
          <tbody id="details-tbody"></tbody>
        </table>
      </div>
    `;
  });

  it('handles missing DOM elements gracefully', (): void => {
    document.body.innerHTML = '';
    expect((): void =>
      setupDetailsModal(
        () => dlData,
        () => ulData,
      ),
    ).not.toThrow();
  });

  it('opens and closes modal via close button, backdrop click, and Escape key', (): void => {
    setupDetailsModal(
      () => dlData,
      () => ulData,
    );

    const dlBtn = document.querySelector('#dl-info-btn') as HTMLButtonElement;
    const modal = document.querySelector('#details-modal') as HTMLDivElement;
    const closeBtn = document.querySelector('#details-close') as HTMLButtonElement;
    const title = document.querySelector('#details-title') as HTMLHeadingElement;

    dlBtn.click();
    expect(modal.classList.contains('hidden')).toBe(false);
    expect(title.textContent).toBe(localize('details_title_dl'));

    closeBtn.click();
    expect(modal.classList.contains('hidden')).toBe(true);

    const ulBtn = document.querySelector('#ul-info-btn') as HTMLButtonElement;
    ulBtn.click();
    expect(modal.classList.contains('hidden')).toBe(false);
    expect(title.textContent).toBe(localize('details_title_ul'));

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(modal.classList.contains('hidden')).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(modal.classList.contains('hidden')).toBe(true);

    dlBtn.click();
    Object.defineProperty(MouseEvent.prototype, 'target', { configurable: true, value: modal });
    modal.click();
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  it('renders sample table and summary row for peak and cumulative calcMethod', (): void => {
    currentSettings.calcMethod = 'peak';
    setupDetailsModal(
      () => dlData,
      () => ulData,
    );

    const dlBtn = document.querySelector('#dl-info-btn') as HTMLButtonElement;
    dlBtn.click();

    const tbody = document.querySelector('#details-tbody') as HTMLTableSectionElement;
    expect(tbody.children.length).toBe(3);
    expect(tbody.textContent).toContain('1000 ms');
    expect(tbody.textContent).toContain('1.00 MB');
    expect(tbody.textContent).toContain('100.50 Mbps');
    expect(tbody.textContent).toContain(localize('settings_calc_peak_title'));

    currentSettings.calcMethod = 'cumulative';
    const ulBtn = document.querySelector('#ul-info-btn') as HTMLButtonElement;
    ulBtn.click();
    expect(tbody.textContent).toContain(localize('settings_calc_cum_title'));
  });

  it('handles empty sample list without rendering summary row', (): void => {
    dlData = { finalSpeed: '', samples: [] };
    setupDetailsModal(
      () => dlData,
      () => ulData,
    );

    const dlBtn = document.querySelector('#dl-info-btn') as HTMLButtonElement;
    dlBtn.click();

    const tbody = document.querySelector('#details-tbody') as HTMLTableSectionElement;
    expect(tbody.children.length).toBe(1);
  });

  it('copies TSV data to clipboard and resets copy state on timeout and close', async (): Promise<void> => {
    vi.useFakeTimers();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    });

    setupDetailsModal(
      () => dlData,
      () => ulData,
    );

    const copyBtn = document.querySelector('#details-copy-btn') as HTMLButtonElement;
    const copyIcon = document.querySelector('#details-copy-icon') as HTMLElement;

    copyBtn.click();
    expect(writeTextMock).not.toHaveBeenCalled();

    const dlBtn = document.querySelector('#dl-info-btn') as HTMLButtonElement;
    dlBtn.click();

    copyBtn.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(writeTextMock).toHaveBeenCalledWith(
      'Time (ms)\tSize (MB)\tSpeed (Mbps)\n1000\t1.00\t100.50\n\nMethod\tPeak Sustained\nTotal (Download)\t100.5',
    );
    expect(copyBtn.classList.contains('copied')).toBe(true);
    expect(copyIcon.innerHTML).toContain('svg');

    copyBtn.click();
    await vi.advanceTimersByTimeAsync(0);

    vi.advanceTimersByTime(1600);
    expect(copyBtn.classList.contains('copied')).toBe(false);

    dlBtn.click();
    copyBtn.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(copyBtn.classList.contains('copied')).toBe(true);

    const closeBtn = document.querySelector('#details-close') as HTMLButtonElement;
    closeBtn.click();
    expect(copyBtn.classList.contains('copied')).toBe(false);
  });

  it('copies TSV for Upload with cumulative calcMethod and handles clipboard failure', async (): Promise<void> => {
    vi.useFakeTimers();
    const writeTextMock = vi.fn().mockRejectedValue(new Error('Clipboard error'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    });

    currentSettings.calcMethod = 'cumulative';
    setupDetailsModal(
      () => dlData,
      () => ulData,
    );

    const ulBtn = document.querySelector('#ul-info-btn') as HTMLButtonElement;
    ulBtn.click();

    const copyBtn = document.querySelector('#details-copy-btn') as HTMLButtonElement;
    copyBtn.click();
    await vi.advanceTimersByTimeAsync(0);

    expect(writeTextMock).toHaveBeenCalledWith(
      'Time (ms)\tSize (MB)\tSpeed (Mbps)\n500\t0.50\t50.20\n\nMethod\tCumulative Average\nTotal (Upload)\t50.2',
    );
    expect(copyBtn.classList.contains('copied')).toBe(false);
  });

  it('handles missing copy button and icon elements without errors', (): void => {
    document.body.innerHTML = `
      <button id="dl-info-btn"></button>
      <button id="ul-info-btn"></button>
      <div id="details-modal" class="hidden">
        <h3 id="details-title"></h3>
        <button id="details-close"></button>
        <table>
          <tbody id="details-tbody"></tbody>
        </table>
      </div>
    `;

    setupDetailsModal(
      () => dlData,
      () => ulData,
    );

    const dlBtn = document.querySelector('#dl-info-btn') as HTMLButtonElement;
    dlBtn.click();
    const closeBtn = document.querySelector('#details-close') as HTMLButtonElement;
    closeBtn.click();
    expect(document.querySelector('#details-modal')?.classList.contains('hidden')).toBe(true);
  });

  it('copies TSV when copy icon element is missing in DOM', async (): Promise<void> => {
    document.body.innerHTML = `
      <button id="dl-info-btn"></button>
      <button id="ul-info-btn"></button>
      <div id="details-modal" class="hidden">
        <h3 id="details-title"></h3>
        <button id="details-close"></button>
        <button id="details-copy-btn"></button>
        <table>
          <tbody id="details-tbody"></tbody>
        </table>
      </div>
    `;

    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    });

    setupDetailsModal(
      () => dlData,
      () => ulData,
    );

    const dlBtn = document.querySelector('#dl-info-btn') as HTMLButtonElement;
    dlBtn.click();

    const copyBtn = document.querySelector('#details-copy-btn') as HTMLButtonElement;
    copyBtn.click();
    await vi.waitFor(() => {
      expect(copyBtn.classList.contains('copied')).toBe(true);
    });
  });
});
