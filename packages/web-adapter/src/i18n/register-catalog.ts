import { registerLocaleCatalog } from '@tensnap/web/i18n';

let registered = false;

export function registerWebAdapterLocaleCatalog(): void {
  if (registered) {
    return;
  }

  registerLocaleCatalog({
    name: 'web-adapter',
    loaders: {
      en: () => import('../locales/en/messages.mjs'),
      zh: () => import('../locales/zh/messages.mjs'),
      ja: () => import('../locales/ja/messages.mjs'),
    },
  });

  registered = true;
}
