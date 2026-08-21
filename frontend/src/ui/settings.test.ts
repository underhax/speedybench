import '../setup.ts';
import { beforeEach, describe, expect, it } from 'vitest';
import { currentSettings, defaultSettings } from '../settings.ts';
import { setupSettingsModal, updateSliderGradient } from './settings.ts';

describe('setupSettingsModal()', () => {
  beforeEach((): void => {
    localStorage.clear();
    sessionStorage.clear();
    Object.assign(currentSettings, defaultSettings);
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
  });

  it('handles missing DOM elements gracefully', (): void => {
    document.body.innerHTML = '';
    expect((): void => setupSettingsModal()).not.toThrow();
  });

  it('initializes and handles modal open, close, and escape key', (): void => {
    setupSettingsModal();

    const toggleBtn = document.querySelector('#settings-toggle') as HTMLElement;
    const modal = document.querySelector('#settings-modal') as HTMLElement;
    const closeBtn = document.querySelector('#modal-close') as HTMLElement;

    toggleBtn.click();
    expect(modal.classList.contains('hidden')).toBe(false);

    closeBtn.click();
    expect(modal.classList.contains('hidden')).toBe(true);

    toggleBtn.click();
    expect(modal.classList.contains('hidden')).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(modal.classList.contains('hidden')).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(modal.classList.contains('hidden')).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(modal.classList.contains('hidden')).toBe(true);

    toggleBtn.click();
    Object.defineProperty(MouseEvent.prototype, 'target', { configurable: true, value: modal });
    modal.click();
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  it('updates draft settings via sliders, threads toggle, and reset button', (): void => {
    setupSettingsModal();

    const toggleBtn = document.querySelector('#settings-toggle') as HTMLElement;
    toggleBtn.click();

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
  });

  it('applies settings changes to currentSettings and persistence', (): void => {
    setupSettingsModal();

    const toggleBtn = document.querySelector('#settings-toggle') as HTMLElement;
    toggleBtn.click();

    const sizeSlider = document.querySelector('#size-slider') as HTMLInputElement;
    sizeSlider.value = '600';
    sizeSlider.dispatchEvent(new Event('input'));

    const timeSlider = document.querySelector('#time-slider') as HTMLInputElement;
    timeSlider.value = '25';
    timeSlider.dispatchEvent(new Event('input'));

    const saveChk = document.querySelector('#save-settings-chk') as HTMLInputElement;
    saveChk.checked = true;
    saveChk.dispatchEvent(new Event('change'));

    const radioCum = document.querySelector(
      'input[name="calcMethod"][value="cumulative"]',
    ) as HTMLInputElement;
    radioCum.checked = true;
    radioCum.dispatchEvent(new Event('change'));

    const applyBtn = document.querySelector('#settings-apply-btn') as HTMLElement;
    applyBtn.click();

    expect(currentSettings.size).toBe(600);
    expect(currentSettings.time).toBe(25);
    expect(currentSettings.save).toBe(true);
    expect(currentSettings.calcMethod).toBe('cumulative');
    expect(localStorage.getItem('speedybench_settings')).toContain('"calcMethod":"cumulative"');
  });

  it('handles peak radio selection properly', (): void => {
    currentSettings.calcMethod = 'cumulative';
    setupSettingsModal();

    const toggleBtn = document.querySelector('#settings-toggle') as HTMLElement;
    toggleBtn.click();

    const radioPeak = document.querySelector(
      'input[name="calcMethod"][value="peak"]',
    ) as HTMLInputElement;
    const radioCum = document.querySelector(
      'input[name="calcMethod"][value="cumulative"]',
    ) as HTMLInputElement;

    radioCum.checked = false;
    radioCum.dispatchEvent(new Event('change'));

    radioPeak.checked = false;
    radioPeak.dispatchEvent(new Event('change'));

    radioPeak.checked = true;
    radioPeak.dispatchEvent(new Event('change'));

    const applyBtn = document.querySelector('#settings-apply-btn') as HTMLElement;
    applyBtn.click();

    expect(currentSettings.calcMethod).toBe('peak');
  });
});

describe('updateSliderGradient()', () => {
  it('updates slider background properly even with missing min/max', (): void => {
    const input = document.createElement('input');
    input.type = 'range';
    updateSliderGradient(input);
    expect(input.style.getPropertyValue('--value-percent')).toBe('0%');
  });

  it('calculates correct percentage', (): void => {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '10';
    input.max = '110';
    input.value = '60';
    updateSliderGradient(input);
    expect(input.style.getPropertyValue('--value-percent')).toBe('50%');
  });

  it('handles max <= min gracefully', (): void => {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '100';
    input.max = '10';
    input.value = '50';
    updateSliderGradient(input);
    expect(input.style.getPropertyValue('--value-percent')).toBe('0%');
  });
});
