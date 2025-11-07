import { i18n } from '@lingui/core';

export const locales = {
  en: 'English',
  zh: '中文',
  ja: '日本語',
};

export const defaultLocale = 'en';

/**
 * Detect the user's preferred locale from various sources:
 * 1. URL parameter (?lang=xx)
 * 2. LocalStorage
 * 3. Browser/System language
 * 4. Default to English
 */
export function detectLocale(): string {
  // Try URL parameter
  const urlParams = new URLSearchParams(window.location.search);
  const langParam = urlParams.get('lang');
  if (langParam && Object.keys(locales).includes(langParam)) {
    return langParam;
  }

  // Try localStorage
  const storedLocale = localStorage.getItem('locale');
  if (storedLocale && Object.keys(locales).includes(storedLocale)) {
    return storedLocale;
  }

  // Try browser language
  const browserLang = navigator.language || (navigator as any).userLanguage;
  if (browserLang) {
    const locale = browserLang.split('-')[0];
    if (Object.keys(locales).includes(locale)) {
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
  const { messages } = await import(`./locales/${locale}/messages.mjs`);
  i18n.load(locale, messages);
  i18n.activate(locale);
}

/**
 * Initialize i18n with the detected or specified locale
 */
export async function initI18n(locale?: string): Promise<string> {
  const activeLocale = locale || detectLocale();
  await activateLocale(activeLocale);
  return activeLocale;
}

export { i18n };
