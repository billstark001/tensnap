export interface SettingsPersistence {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

class BrowserSettingsPersistence implements SettingsPersistence {
  async get(key: string): Promise<string | null> {
    try {
      return globalThis.localStorage?.getItem(key) ?? null;
    } catch {
      return null;
    }
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
