import { localize } from '../localize.ts';
import { currentSettings } from '../settings.ts';
import { copyToClipboard, formatSamplesTSV } from '../utils.ts';

const svgs = import.meta.glob('../icons/*.svg', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

export type SampleObj = { speed: number; bytes: number; timeMs: number };

export interface DetailsData {
  samples: SampleObj[];
  finalSpeed: string;
}

export function setupDetailsModal(
  getDlDetails: () => DetailsData,
  getUlDetails: () => DetailsData,
): void {
  const modal = document.querySelector('#details-modal') as HTMLDivElement;
  const closeBtn = document.querySelector('#details-close') as HTMLButtonElement;
  const copyBtn = document.querySelector('#details-copy-btn') as HTMLButtonElement;
  const copyIcon = document.querySelector('#details-copy-icon') as HTMLElement;
  const dlBtn = document.querySelector('#dl-info-btn') as HTMLButtonElement;
  const ulBtn = document.querySelector('#ul-info-btn') as HTMLButtonElement;
  const tbody = document.querySelector('#details-tbody') as HTMLTableSectionElement;
  const title = document.querySelector('#details-title') as HTMLHeadingElement;

  if (!modal || !closeBtn || !dlBtn || !ulBtn || !tbody) return;

  let currentSamples: SampleObj[] = [];
  let currentType: 'Download' | 'Upload' = 'Download';
  let currentFinalVal = '';
  let copyTimeoutId: ReturnType<typeof setTimeout> | null = null;

  const resetCopyBtn = (): void => {
    if (copyTimeoutId) {
      clearTimeout(copyTimeoutId);
      copyTimeoutId = null;
    }
    if (copyBtn) {
      copyBtn.classList.remove('copied');
      copyBtn.setAttribute('title', localize('copy_tsv'));
      copyBtn.setAttribute('aria-label', localize('copy_tsv'));
    }
    if (copyIcon) {
      copyIcon.innerHTML = svgs['../icons/copy.svg'] as string;
    }
  };

  const openModal = (
    type: 'Download' | 'Upload',
    samples: SampleObj[],
    finalSpeed: string,
  ): void => {
    currentSamples = samples;
    currentType = type;
    currentFinalVal = finalSpeed;
    resetCopyBtn();
    title.textContent =
      type === 'Download' ? localize('details_title_dl') : localize('details_title_ul');

    tbody.innerHTML = '';
    const theadRow = document.createElement('tr');

    const thTime = document.createElement('th');
    thTime.setAttribute('data-i18n', 'details_time');
    thTime.textContent = localize('details_time');

    const thSize = document.createElement('th');
    thSize.setAttribute('data-i18n', 'details_size');
    thSize.textContent = localize('details_size');

    const thSpeed = document.createElement('th');
    thSpeed.setAttribute('data-i18n', 'details_speed');
    thSpeed.textContent = localize('details_speed');

    theadRow.appendChild(thTime);
    theadRow.appendChild(thSize);
    theadRow.appendChild(thSpeed);
    tbody.appendChild(theadRow);

    samples.forEach((val) => {
      const timeStr = `${val.timeMs.toFixed(0)} ${localize('unit_ms')}`;
      const sizeStr = `${(val.bytes / 1024 / 1024).toFixed(2)} ${localize('unit_mb')}`;
      const speedStr = `${val.speed.toFixed(2)} ${localize('unit_mbps')}`;

      const tr = document.createElement('tr');
      const tdTime = document.createElement('td');
      const tdSize = document.createElement('td');
      const tdSpeed = document.createElement('td');

      tdTime.textContent = timeStr;
      tdSize.textContent = sizeStr;
      tdSpeed.textContent = speedStr;

      tr.appendChild(tdTime);
      tr.appendChild(tdSize);
      tr.appendChild(tdSpeed);
      tbody.appendChild(tr);
    });

    const last = samples[samples.length - 1];
    if (last) {
      const summaryTr = document.createElement('tr');
      summaryTr.classList.add('details-summary-row');

      const tdSumLabel = document.createElement('td');
      tdSumLabel.setAttribute('colspan', '2');
      const methodKey =
        currentSettings.calcMethod === 'peak'
          ? 'settings_calc_peak_title'
          : 'settings_calc_cum_title';
      tdSumLabel.innerHTML = `${localize('details_summary')}<br><span class="details-method-name">${localize(methodKey)}</span>`;

      const tdSumSpeed = document.createElement('td');
      tdSumSpeed.textContent = `${finalSpeed} ${localize('unit_mbps')}`;

      summaryTr.appendChild(tdSumLabel);
      summaryTr.appendChild(tdSumSpeed);
      tbody.appendChild(summaryTr);
    }

    modal.classList.remove('hidden');
  };

  const closeModal = (): void => {
    resetCopyBtn();
    modal.classList.add('hidden');
  };

  copyBtn?.addEventListener('click', async (): Promise<void> => {
    if (currentSamples.length === 0) return;

    const directionStr = localize(currentType === 'Download' ? 'download' : 'upload');
    const methodKey =
      currentSettings.calcMethod === 'peak'
        ? 'settings_calc_peak_title'
        : 'settings_calc_cum_title';

    const tsv = formatSamplesTSV(currentSamples, {
      finalSpeed: currentFinalVal,
      methodLabel: localize('method'),
      methodValue: localize(methodKey),
      totalLabel: `${localize('details_summary')} (${directionStr})`,
    });

    const success = await copyToClipboard(tsv);
    if (success) {
      copyBtn.classList.add('copied');
      if (copyIcon) copyIcon.innerHTML = svgs['../icons/check.svg'] as string;
      copyBtn.setAttribute('title', localize('copied'));
      copyBtn.setAttribute('aria-label', localize('copied'));
      if (copyTimeoutId) clearTimeout(copyTimeoutId);
      copyTimeoutId = setTimeout(resetCopyBtn, 1500);
    }
  });

  dlBtn.addEventListener('click', () => {
    const data = getDlDetails();
    openModal('Download', data.samples, data.finalSpeed);
  });
  ulBtn.addEventListener('click', () => {
    const data = getUlDetails();
    openModal('Upload', data.samples, data.finalSpeed);
  });
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeModal();
    }
  });
}
