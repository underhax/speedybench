interface DebugConfig {
  debug: boolean;
}

let isDebugEnabled = false;

const isDebugConfig = (value: unknown): value is DebugConfig => {
  if (typeof value !== 'object' || value === null || !('debug' in value)) {
    return false;
  }

  return typeof value.debug === 'boolean';
};

export function setDebugEnabled(enabled: boolean): void {
  isDebugEnabled = enabled;
}

export function getDebugEnabled(): boolean {
  return isDebugEnabled;
}

export async function loadDebugConfig(): Promise<void> {
  try {
    const response = await fetch('./api/config');
    if (!response.ok) {
      setDebugEnabled(false);
      return;
    }

    const config: unknown = await response.json();
    setDebugEnabled(isDebugConfig(config) && config.debug);
  } catch {
    setDebugEnabled(false);
  }
}

export function debugLog(...args: unknown[]): void {
  if (isDebugEnabled) {
    console.debug('[speedybench]', ...args);
  }
}
