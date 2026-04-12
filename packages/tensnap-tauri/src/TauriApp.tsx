import React, { useEffect, useState } from 'react';
import { Providers } from '@tensnap/web/Providers';
import { TauriFileSystemAdapter, TauriFilePicker } from './adapters';
import { registerFileSystemAdapter, registerFileSystemPicker } from '@tensnap/web/store/file-system/provider';
import { detectLocale, initI18n, isValidLocale } from '@tensnap/web/i18n';
import { useTauriMenuEvents } from './hooks/useTauriMenuEvents';
import { App } from '@tensnap/web/index';
import { getOsName } from './adapters/common';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useSettingsStore } from '@tensnap/web/src/store/settings';

const TauriMenuEventsLoader = () => {
  useTauriMenuEvents();
  return null;
}

async function isDarkMode() {
  const theme = await getCurrentWindow().theme();
  return theme === 'dark';
}

const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
if (!savedTheme) {
  isDarkMode().then(dark => {
    const initialTheme = dark ? 'dark' : 'light';
    document.body.setAttribute('data-theme', initialTheme);
    localStorage.setItem('theme', initialTheme);
  });
} else {
  document.body.setAttribute('data-theme', savedTheme);
}

export const TauriApp: React.FC = () => {
  const [isMac, setIsMac] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setTheme = useSettingsStore((state) => state.setTheme);

  useEffect(() => {
    const initialize = async () => {
      try {
        const osName = await getOsName();
        setIsMac(osName === 'macos' || osName === 'darwin' || osName === 'macOS');

        // Initialize i18n with detected locale
        const savedLocale = localStorage.getItem('locale');
        const initialLocale = (savedLocale && isValidLocale(savedLocale)) ? savedLocale : detectLocale();
        await initI18n(initialLocale);

        // Initialize theme in settings store
        if (!localStorage.getItem('theme')) {
          const darkMode = await isDarkMode();
          const initialTheme = darkMode ? 'dark' : 'light';
          setTheme(initialTheme);
        }

        // Register the Tauri file system adapter
        await registerFileSystemAdapter({
          name: 'tauri',
          description: 'Native file system access via Tauri',
          supported: typeof window !== 'undefined' && '__TAURI__' in window,
          create: () => new TauriFileSystemAdapter()
        });

        // Register the Tauri file picker
        await registerFileSystemPicker(new TauriFilePicker());

        setIsReady(true);
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error) || 'Unknown error during initialization');
        setIsReady(true);
      }
    };

    initialize();
  }, []);

  if (!isReady) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        fontSize: '1.2rem',
        color: '#666'
      }}>
        Initializing...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        fontSize: '1.2rem',
        color: '#666'
      }}>
        Error initializing: {error}
      </div>
    );
  }

  return (
    <Providers>
      <TauriMenuEventsLoader />
      <App environment='tauri' system={isMac ? 'mac' : 'other'} />
    </Providers>
  );
};
