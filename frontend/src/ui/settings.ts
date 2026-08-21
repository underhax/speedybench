import { currentSettings, defaultSettings, saveSettings, serverThreads } from '../settings.ts';

const svgs = import.meta.glob('../icons/*.svg', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

export function updateSliderGradient(slider: HTMLInputElement): void {
  const min = Number.parseFloat(slider.min) || 0;
  const max = Number.parseFloat(slider.max) || 100;
  const val = Number.parseFloat(slider.value) || 0;
  const percent = max > min ? ((val - min) / (max - min)) * 100 : 0;
  slider.style.setProperty('--value-percent', `${percent}%`);
}

export function setupSettingsModal(): void {
  const modal = document.querySelector('#settings-modal') as HTMLDivElement;
  const toggleBtn = document.querySelector('#settings-toggle') as HTMLButtonElement;
  const closeBtn = document.querySelector('#modal-close') as HTMLButtonElement;
  const applyBtn = document.querySelector('#settings-apply-btn') as HTMLButtonElement;
  const resetBtn = document.querySelector('#settings-reset-btn') as HTMLButtonElement;

  const sizeSlider = document.querySelector('#size-slider') as HTMLInputElement;
  const timeSlider = document.querySelector('#time-slider') as HTMLInputElement;
  const threadsToggle = document.querySelector('#threads-toggle') as HTMLButtonElement;
  const threadsIcon = document.querySelector('#threads-icon') as HTMLSpanElement;
  const labelMulti = document.querySelector('#label-multi') as HTMLSpanElement;
  const labelSingle = document.querySelector('#label-single') as HTMLSpanElement;
  const saveChk = document.querySelector('#save-settings-chk') as HTMLInputElement;
  const radioCum = document.querySelector(
    'input[name="calcMethod"][value="cumulative"]',
  ) as HTMLInputElement;
  const radioPeak = document.querySelector(
    'input[name="calcMethod"][value="peak"]',
  ) as HTMLInputElement;

  const sizeVal = document.querySelector('#size-val') as HTMLSpanElement;
  const timeVal = document.querySelector('#time-val') as HTMLSpanElement;

  if (
    !modal ||
    !toggleBtn ||
    !closeBtn ||
    !sizeSlider ||
    !timeSlider ||
    !threadsToggle ||
    !saveChk ||
    !radioCum ||
    !radioPeak ||
    !applyBtn ||
    !resetBtn
  )
    return;

  let draftSettings = { ...currentSettings };

  const updateUI = (): void => {
    sizeSlider.value = draftSettings.size.toString();
    timeSlider.value = draftSettings.time.toString();
    updateSliderGradient(sizeSlider);
    updateSliderGradient(timeSlider);
    saveChk.checked = draftSettings.save;

    if (draftSettings.calcMethod === 'peak') {
      radioPeak.checked = true;
    } else {
      radioCum.checked = true;
    }

    sizeVal.textContent = draftSettings.size.toString();
    timeVal.textContent = draftSettings.time.toString();

    const isMulti = draftSettings.threads > 1;
    threadsIcon.innerHTML = svgs[`../icons/threads-${isMulti ? 'multi' : 'single'}.svg`] as string;
    labelMulti.classList.toggle('inactive', !isMulti);
    labelSingle.classList.toggle('inactive', isMulti);
    threadsToggle.setAttribute('aria-pressed', isMulti ? 'true' : 'false');
  };

  draftSettings = { ...currentSettings };
  updateUI();

  const openModal = (): void => {
    draftSettings = { ...currentSettings };
    modal.classList.remove('hidden');
    updateUI();
  };

  const closeModal = (): void => {
    modal.classList.add('hidden');
  };

  toggleBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeModal();
    }
  });

  applyBtn.addEventListener('click', () => {
    Object.assign(currentSettings, draftSettings);
    saveSettings();
    closeModal();
  });

  resetBtn.addEventListener('click', () => {
    draftSettings = { ...defaultSettings };
    updateUI();
  });

  sizeSlider.addEventListener('input', (e) => {
    const val = Number.parseInt((e.target as HTMLInputElement).value, 10);
    draftSettings.size = val;
    sizeVal.textContent = val.toString();
    updateSliderGradient(sizeSlider);
  });
  timeSlider.addEventListener('input', (e) => {
    const val = Number.parseInt((e.target as HTMLInputElement).value, 10);
    draftSettings.time = val;
    timeVal.textContent = val.toString();
    updateSliderGradient(timeSlider);
  });
  threadsToggle.addEventListener('click', () => {
    draftSettings.threads = draftSettings.threads > 1 ? 1 : serverThreads;
    updateUI();
  });
  labelMulti.addEventListener('click', () => {
    draftSettings.threads = serverThreads;
    updateUI();
  });
  labelSingle.addEventListener('click', () => {
    draftSettings.threads = 1;
    updateUI();
  });
  saveChk.addEventListener('change', (e) => {
    draftSettings.save = (e.target as HTMLInputElement).checked;
  });
  radioCum.addEventListener('change', (e) => {
    if ((e.target as HTMLInputElement).checked) {
      draftSettings.calcMethod = 'cumulative';
    }
  });
  radioPeak.addEventListener('change', (e) => {
    if ((e.target as HTMLInputElement).checked) {
      draftSettings.calcMethod = 'peak';
    }
  });
}
