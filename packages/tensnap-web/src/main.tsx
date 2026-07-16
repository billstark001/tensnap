import './runtime/leafer-runtime';

import React, { PropsWithChildren } from 'react';
import ReactDOM from 'react-dom/client';
import { Providers } from './Providers';
import { App } from './App';

import '@tensnap/web-common/styles/global.css';
import { InBrowserFilePicker, registerWebAdapterLocaleCatalog } from '@tensnap/web-adapter';
import { getJsExampleEntries } from '@tensnap/examples-js';
import { initI18n, detectLocale, i18n, registerLocaleCatalog } from './i18n';
import { registerFileSystemAdapter, registerFileSystemPicker } from './store/file-system/provider';
import { getSettingsPersistence, hydrateSettings, useSettingsStore } from './store';
import { IndexedDBFileSystemAdapter } from '@tensnap/web-adapter/adapters';
import { I18nProvider } from '@lingui/react';
import { registerBuiltinModels } from './transport';

registerBuiltinModels(
  getJsExampleEntries().map((entry) => ({
    id: entry.id,
    name: entry.name,
    description: entry.description,
    protocolVersion: entry.protocolVersion,
    create: entry.createTransport,
  }))
);

function isDarkMode() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

(async () => {
  await hydrateSettings();
  const persistence = getSettingsPersistence();
  const [savedTheme, savedLocale] = await Promise.all([
    persistence.get('theme'),
    persistence.get('locale'),
  ]);
  const initialTheme = savedTheme === 'light' || savedTheme === 'dark'
    ? savedTheme
    : (isDarkMode() ? 'dark' : 'light');
  useSettingsStore.getState().setTheme(initialTheme);
  const initialLocale = detectLocale(savedLocale);
  useSettingsStore.getState().setLocale(initialLocale);
  document.body.setAttribute('data-theme', initialTheme);

  registerWebAdapterLocaleCatalog(registerLocaleCatalog);
  await initI18n(initialLocale);

  // Register available file system adapters
  const adapter = await registerFileSystemAdapter({
    name: 'indexeddb',
    description: 'Browser IndexedDB storage (recommended for web)',
    supported: typeof window !== 'undefined' && 'indexedDB' in window,
    create: () => new IndexedDBFileSystemAdapter()
  });
  await registerFileSystemPicker(new InBrowserFilePicker(
    document.getElementById('file-picker-root')!,
    adapter,
    ({ children }: PropsWithChildren) => <I18nProvider i18n={i18n}>{children}</I18nProvider>
  ));

  const root = ReactDOM.createRoot(
    document.getElementById('root') as HTMLElement
  );

  root.render(
    <React.StrictMode>
      <Providers>
        <App />
      </Providers>
    </React.StrictMode>
  );
})();
