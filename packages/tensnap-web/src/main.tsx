import React from 'react';
import ReactDOM from 'react-dom/client';
import { Providers } from './Providers';
import { App } from './App';

import './styles/global.css';
import { InBrowserFilePicker, createSchellingSimulation } from 'tensnap-web-utils';
import { WebSocketManagerFake } from './websocket/fake';
import { initI18n, detectLocale, isValidLocale } from './i18n';
import { registerFileSystemAdapter, registerFileSystemPicker } from './store/file-system/provider';
import { IndexedDBFileSystemAdapter } from 'tensnap-web-utils/adapters';


if (!window.structuredClone) {
  window.structuredClone = (obj: any) => JSON.parse(JSON.stringify(obj));
}

// Register fake models for development/testing
WebSocketManagerFake.setGlobalOptions('fake:schelling', createSchellingSimulation() as any);

const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
const initialTheme = savedTheme || 'light';
document.body.setAttribute('data-theme', initialTheme);

// Initialize i18n with detected locale
const savedLocale = localStorage.getItem('locale');
const initialLocale = (savedLocale && isValidLocale(savedLocale)) ? savedLocale : detectLocale();

(async () => {
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