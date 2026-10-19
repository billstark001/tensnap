export interface SettingsPersistence {
  get(key: string): Promise<string | null>;
  keys(): Promise<string[]>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

class BrowserSettingsPersistence implements SettingsPersistence {
  async keys(): Promise<string[]> {
    return Object.keys(globalThis.localStorage);
  }

  async get(key: string): Promise<string | null> {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  async remove(key: string): Promise<void> {
    globalThis.localStorage?.removeItem(key);
  }

  async set(key: string, value: string): Promise<void> {
    try {
      globalThis.localStorage?.setItem(key, value);
    } catch {
      // Storage can be unavailable in tests, SSR, or private browsing modes.
    }
  }
}

let settingsPersistence: SettingsPersistence = new BrowserSettingsPersistence();

export function configureSettingsPersistence(persistence: SettingsPersistence): void {
  settingsPersistence = persistence;
}

export function getSettingsPersistence(): SettingsPersistence {
  return settingsPersistence;
}
