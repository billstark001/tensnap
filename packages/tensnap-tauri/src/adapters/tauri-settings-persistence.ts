import { Store } from '@tauri-apps/plugin-store';
import type { SettingsPersistence } from '@tensnap/web/store';

/** Settings are stored in Tauri's app-data directory, not WebView storage. */
export class TauriSettingsPersistence implements SettingsPersistence {
  private readonly store = Store.load('settings.json', {
    defaults: {},
    autoSave: 100,
  });

  async get(key: string): Promise<string | null> {
    const value = await (await this.store).get<unknown>(key);
    return typeof value === 'string' ? value : null;
  }

  async set(key: string, value: string): Promise<void> {
    await (await this.store).set(key, value);
  }
}
