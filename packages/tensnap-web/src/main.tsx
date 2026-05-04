import './runtime/leafer-runtime';

import React, { PropsWithChildren } from 'react';
import ReactDOM from 'react-dom/client';
import { Providers } from './Providers';
import { App } from './App';

import '@tensnap/web-common/styles/global.css';
import { InBrowserFilePicker, registerWebAdapterLocaleCatalog } from '@tensnap/web-adapter';
import { getJsExampleEntries } from '@tensnap/examples-js';
import { initI18n, detectLocale, isValidLocale, i18n, registerLocaleCatalog } from './i18n';
import { registerFileSystemAdapter, registerFileSystemPicker } from './store/file-system/provider';
import { IndexedDBFileSystemAdapter } from '@tensnap/web-adapter/adapters';
import { I18nProvider } from '@lingui/react';
import { registerBuiltinModels } from './transport';


if (!window.structuredClone) {
  window.structuredClone = (obj: any) => JSON.parse(JSON.stringify(obj));
}

registerBuiltinModels(
  getJsExampleEntries().map((entry) => ({
    id: entry.id,
    name: entry.name,
    description: entry.description,
    create: entry.createTransport,
  }))
);

function isDarkMode() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
const initialTheme = savedTheme || (isDarkMode() ? 'dark' : 'light');
document.body.setAttribute('data-theme', initialTheme);

// Initialize i18n with detected locale
const savedLocale = localStorage.getItem('locale');
const initialLocale = (savedLocale && isValidLocale(savedLocale)) ? savedLocale : detectLocale();

(async () => {
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