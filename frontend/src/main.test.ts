import './setup.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Main', () => {
  beforeEach((): void => {
    localStorage.clear();
    sessionStorage.clear();
    vi.resetModules();
    document.body.innerHTML = `
      <div id="logo-icon"></div>
      <div id="theme-toggle"></div>
      <div id="startStopBtn"></div>
      <div id="lang-dropdown"></div>
      <div id="lang-selected"></div>
      <span id="current-lang-text"></span>
      <ul id="lang-options"></ul>
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
      <div id="details-modal" class="hidden">
        <h3 id="details-title"></h3>
        <button id="details-copy-btn"><span id="details-copy-icon"></span></button>
        <button id="details-close"></button>
        <button id="dl-info-btn"></button>
        <button id="ul-info-btn"></button>
        <table>
          <tbody id="details-tbody"></tbody>
        </table>
      </div>
    `;

    const fetchMock = vi.fn().mockResolvedValue({
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

  it('bootstraps all frontend submodules on load', async (): Promise<void> => {
    await expect(import('./main.ts')).resolves.toBeDefined();
    expect(document.querySelector('#startStopBtn')).not.toBeNull();
    expect(document.querySelector('#logo-icon')?.innerHTML).toContain('svg');
  });
});
