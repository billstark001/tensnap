type LocaleMessages = Record<string, string>;
type LocaleLoader = () => Promise<{ messages: LocaleMessages }>;

export interface LocaleCatalogRegistration {
  name: string;
  loaders: Partial<Record<'en' | 'zh' | 'ja', LocaleLoader>>;
}

type RegisterLocaleCatalog = (registration: LocaleCatalogRegistration) => void;

let registered = false;

export function registerWebAdapterLocaleCatalog(registerLocaleCatalog: RegisterLocaleCatalog): void {
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
