import { Store } from '@tauri-apps/plugin-store';
import type { SettingsPersistence } from '@tensnap/web-common/settings-persistence';

/** Settings are stored in Tauri's app-data directory, not WebView storage. */
export class TauriSettingsPersistence implements SettingsPersistence {
  private readonly store = Store.load('settings.json', {
    defaults: {},
    autoSave: 100,
  });

  async keys(): Promise<string[]> {
    return (await this.store).keys();
  }

  async get(key: string): Promise<string | null> {
    const value = await (await this.store).get<unknown>(key);
    return typeof value === 'string' ? value : null;
  }

  async remove(key: string): Promise<void> {
    await (await this.store).delete(key);
  }

  async set(key: string, value: string): Promise<void> {
    await (await this.store).set(key, value);
  }
}
