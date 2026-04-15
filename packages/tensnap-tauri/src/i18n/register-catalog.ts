import { registerLocaleCatalog } from '@tensnap/web/i18n';

let registered = false;

export function registerTauriLocaleCatalog(): void {
  if (registered) {
    return;
  }

  registerLocaleCatalog({
    name: 'tauri',
    loaders: {
      en: () => import('../locales/en/messages.mjs'),
      zh: () => import('../locales/zh/messages.mjs'),
      ja: () => import('../locales/ja/messages.mjs'),
    },
  });

  registered = true;
}
