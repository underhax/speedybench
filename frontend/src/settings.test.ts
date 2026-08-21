import './setup.ts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  currentSettings,
  defaultSettings,
  initServerInfo,
  loadSettings,
  saveSettings,
  serverThreads,
} from './settings.ts';

describe('Settings', () => {
  beforeEach((): void => {
    localStorage.clear();
    sessionStorage.clear();
    Object.assign(currentSettings, defaultSettings);
    vi.resetModules();
  });

  it('loads default settings when storage is empty', (): void => {
    localStorage.clear();
    sessionStorage.clear();
    loadSettings();
    expect(currentSettings).toEqual(defaultSettings);
  });

  it('loads settings from localStorage when present', (): void => {
    localStorage.setItem(
      'speedybench_settings',
      JSON.stringify({ calcMethod: 'cumulative', save: true, size: 500, threads: 2, time: 20 }),
    );
    loadSettings();
    expect(currentSettings.size).toBe(500);
    expect(currentSettings.time).toBe(20);
    expect(currentSettings.threads).toBe(2);
    expect(currentSettings.calcMethod).toBe('cumulative');
    expect(currentSettings.save).toBe(true);
  });

  it('loads settings from sessionStorage when present and localStorage is empty', (): void => {
    sessionStorage.setItem(
      'speedybench_settings',
      JSON.stringify({ calcMethod: 'cumulative', save: false, size: 999, threads: 8, time: 25 }),
    );
    loadSettings();
    expect(currentSettings.size).toBe(999);
    expect(currentSettings.save).toBe(false);
  });

  it('handles invalid json in storage gracefully', (): void => {
    localStorage.setItem('speedybench_settings', '{invalid json}');
    sessionStorage.removeItem('speedybench_settings');
    loadSettings();
    expect(currentSettings).toEqual(defaultSettings);

    localStorage.removeItem('speedybench_settings');
    sessionStorage.setItem('speedybench_settings', '{invalid json}');
    loadSettings();
    expect(currentSettings).toEqual(defaultSettings);
  });

  it('saves settings to localStorage when save is true', (): void => {
    currentSettings.save = true;
    currentSettings.size = 350;
    saveSettings();
    expect(localStorage.getItem('speedybench_settings')).toContain('"size":350');
    expect(sessionStorage.getItem('speedybench_settings')).toBeNull();
  });

  it('saves settings to sessionStorage when save is false', (): void => {
    currentSettings.save = false;
    currentSettings.size = 450;
    saveSettings();
    expect(sessionStorage.getItem('speedybench_settings')).toContain('"size":450');
    expect(localStorage.getItem('speedybench_settings')).toBeNull();
  });

  it('updates serverThreads based on cpu api response', async (): Promise<void> => {
    const fetchMock = vi.fn().mockResolvedValue({
      text: vi.fn().mockResolvedValue('8'),
    });
    vi.stubGlobal('fetch', fetchMock);

    currentSettings.threads = 4;
    await initServerInfo();
    expect(fetchMock).toHaveBeenCalledWith('./api/cpu');
    expect(serverThreads).toBe(6);
    expect(currentSettings.threads).toBe(6);

    fetchMock.mockResolvedValueOnce({
      text: vi.fn().mockResolvedValue('2'),
    });
    await initServerInfo();
    expect(serverThreads).toBe(4);
    expect(currentSettings.threads).toBe(4);

    currentSettings.threads = 1;
    fetchMock.mockResolvedValueOnce({
      text: vi.fn().mockResolvedValue('8'),
    });
    await initServerInfo();
    expect(currentSettings.threads).toBe(1);

    fetchMock.mockResolvedValueOnce({ text: vi.fn().mockResolvedValue('0') });
    await initServerInfo();

    fetchMock.mockResolvedValueOnce({ text: vi.fn().mockResolvedValue('abc') });
    await initServerInfo();

    fetchMock.mockRejectedValueOnce(new Error('Network error'));
    await initServerInfo();

    vi.unstubAllGlobals();
  });
});
