export interface Settings {
  size: number;
  time: number;
  threads: number;
  calcMethod: 'cumulative' | 'peak';
  save: boolean;
}

export const defaultSettings: Settings = {
  calcMethod: 'peak',
  save: false,
  size: 200,
  threads: 3,
  time: 15,
};

export let serverThreads = 3;
export let currentSettings: Settings = { ...defaultSettings };

export function loadSettings(): void {
  const local = localStorage.getItem('speedybench_settings');
  if (local) {
    try {
      currentSettings = { ...defaultSettings, ...JSON.parse(local), save: true };
      return;
    } catch {}
  }

  const session = sessionStorage.getItem('speedybench_settings');
  if (session) {
    try {
      currentSettings = { ...defaultSettings, ...JSON.parse(session), save: false };
    } catch {}
  }
}

export function saveSettings(): void {
  const json = JSON.stringify(currentSettings);
  if (currentSettings.save) {
    localStorage.setItem('speedybench_settings', json);
    sessionStorage.removeItem('speedybench_settings');
  } else {
    sessionStorage.setItem('speedybench_settings', json);
    localStorage.removeItem('speedybench_settings');
  }
}

export function initServerInfo(): Promise<void> {
  return fetch('./api/cpu')
    .then((res) => res.text())
    .then((text) => {
      const cpus = Number.parseInt(text, 10);
      if (!Number.isNaN(cpus) && cpus > 0) {
        serverThreads = cpus <= 4 ? 3 : 5;
        if (currentSettings.threads > 1) {
          currentSettings.threads = serverThreads;
        }
      }
    })
    .catch(Object);
}

loadSettings();
void initServerInfo();
