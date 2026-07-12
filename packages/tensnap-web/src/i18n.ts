import { i18n } from '@lingui/core';

export type LocaleMessages = Record<string, string>;
type LocaleLoader = () => Promise<{ messages: LocaleMessages }>;

export interface LocaleCatalogRegistration {
  name: string;
  loaders: Partial<Record<Locale, LocaleLoader>>;
}

const localeCatalogs = new Map<string, LocaleCatalogRegistration>();

export const locales = {
  en: 'English',
  zh: '中文',
  ja: '日本語',
} as const;

export type Locale = keyof typeof locales;

export const defaultLocale: Locale = 'en';

export function registerLocaleCatalog(registration: LocaleCatalogRegistration): void {
  localeCatalogs.set(registration.name, registration);
}

export function unregisterLocaleCatalog(name: string): void {
  localeCatalogs.delete(name);
}

async function loadRegisteredLocaleMessages(locale: Locale): Promise<void> {
  for (const registration of localeCatalogs.values()) {
    const loader = registration.loaders[locale];
    if (!loader) {
      continue;
    }
    try {
      const { messages } = await loader();
      i18n.load(locale, messages);
    } catch (error) {
      console.warn(`[i18n] Failed to load catalog "${registration.name}" for locale "${locale}"`, error);
    }
  }
}

/**
 * Type guard to check if a string is a valid locale
 */
export function isValidLocale(locale: string): locale is Locale {
  return locale in locales;
}

/**
 * Detect the user's preferred locale from various sources:
 * 1. URL parameter (?lang=xx)
 * 2. A persisted locale supplied by the host
 * 3. Browser/System language
 * 4. Default to English
 */
export function detectLocale(persistedLocale?: string | null): Locale {
  // Try URL parameter
  const urlParams = new URLSearchParams(window.location.search);
  const langParam = urlParams.get('lang');
  if (langParam && isValidLocale(langParam)) {
    return langParam;
  }

  if (persistedLocale && isValidLocale(persistedLocale)) {
    return persistedLocale;
  }

  const browserLang = navigator.language;
  if (browserLang) {
    const locale = browserLang.split('-')[0];
    if (isValidLocale(locale)) {
      return locale;
    }
  }

  // Default
  return defaultLocale;
}

/**
 * Load and activate a locale
 */
export async function activateLocale(locale: string) {
  if (!isValidLocale(locale)) {
    throw new Error(`Unsupported locale: ${locale}`);
  }
  const { messages } = await import(`./locales/${locale}/messages.mjs`);
  i18n.load(locale, messages);
  await loadRegisteredLocaleMessages(locale);
  i18n.activate(locale);
}

/**
 * Initialize i18n with the detected or specified locale
 */
export async function initI18n(locale?: string): Promise<Locale> {
  let activeLocale: Locale;
  
  if (locale && isValidLocale(locale)) {
    activeLocale = locale;
  } else {
    activeLocale = detectLocale();
  }
  
  await activateLocale(activeLocale);
  return activeLocale;
}

export { i18n };
