
import { invoke } from '@tauri-apps/api/core';
import type { Locale } from '@tensnap/web/i18n';

export async function getOsName(): Promise<string> {
  return await invoke<string>('get_os_name_handler');
}

/** Keep the native desktop menu aligned with the renderer's active locale. */
export async function setNativeMenuLocale(locale: Locale): Promise<void> {
  await invoke('set_menu_locale_handler', { locale });
}
