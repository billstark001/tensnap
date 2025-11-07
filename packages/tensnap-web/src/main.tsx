import React from 'react';
import ReactDOM from 'react-dom/client';
import { Providers } from './Providers';
import { App } from './App';

import './styles/global.css';
import { UseFileSystemGuard } from './store/file-system/provider';
import { registerFakeModels } from 'tensnap-web-utils';
import { WebSocketManagerFake } from './websocket/fake';
import { initI18n, detectLocale } from './i18n';
import { useSettingsStore } from './store/settings';

// Register fake models for development/testing
registerFakeModels(WebSocketManagerFake);

const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
const initialTheme = savedTheme || 'light';
document.body.setAttribute('data-theme', initialTheme);

// Initialize i18n with detected locale
const savedLocale = localStorage.getItem('locale');
const initialLocale = savedLocale || detectLocale();

initI18n(initialLocale).then((locale) => {
  // Update settings store with the initialized locale
  useSettingsStore.getState().setLocale(locale as 'en' | 'zh' | 'ja');
  
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Providers>
        <UseFileSystemGuard>
          <App />
        </UseFileSystemGuard>
      </Providers>
    </React.StrictMode>
  );
});