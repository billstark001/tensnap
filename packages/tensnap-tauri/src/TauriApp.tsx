import React, { useEffect, useState } from 'react';
import { App, Providers } from '@tensnap/web';
import { TauriFileSystemAdapter, TauriFilePicker, TauriSettingsPersistence } from './adapters';
import {
  configureSettingsPersistence,
  getSettingsPersistence,
  hydrateSettings,
  registerFileSystemAdapter,
  registerFileSystemPicker,
  useSettingsStore,
} from '@tensnap/web/store';
import { detectLocale, initI18n } from '@tensnap/web/i18n';
import { useTauriMenuEvents } from './hooks/useTauriMenuEvents';
import { getOsName } from './adapters/common';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { registerTauriLocaleCatalog } from './i18n/register-catalog';

const TauriMenuEventsLoader = () => {
  useTauriMenuEvents();
  return null;
}

configureSettingsPersistence(new TauriSettingsPersistence());

async function isDarkMode() {
  const theme = await getCurrentWindow().theme();
  return theme === 'dark';
}

export const TauriApp: React.FC = () => {
  const [isMac, setIsMac] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setTheme = useSettingsStore((state) => state.setTheme);

  useEffect(() => {
    const window = getCurrentWindow();
    let disposed = false;

    const syncFullscreenState = async () => {
      try {
        const fullscreen = await window.isFullscreen();
        if (!disposed) {
          setIsFullscreen(fullscreen);
        }
      } catch (error) {
        console.warn('Failed to read the Tauri fullscreen state:', error);
      }
    };

    void syncFullscreenState();
    const unlisten = window.onResized(() => {
      void syncFullscreenState();
    });

    return () => {
      disposed = true;
      void unlisten.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    const initialize = async () => {
      try {
        registerTauriLocaleCatalog();

        const osName = await getOsName();
        setIsMac(osName === 'macos' || osName === 'darwin' || osName === 'macOS');

        await hydrateSettings();
        const persistence = getSettingsPersistence();
        const [savedLocale, savedTheme] = await Promise.all([
          persistence.get('locale'),
          persistence.get('theme'),
        ]);

        const initialLocale = detectLocale(savedLocale);
        useSettingsStore.getState().setLocale(initialLocale);
        await initI18n(initialLocale);

        if (savedTheme !== 'light' && savedTheme !== 'dark') {
          const darkMode = await isDarkMode();
          const initialTheme = darkMode ? 'dark' : 'light';
          setTheme(initialTheme);
        }
        document.body.setAttribute('data-theme', useSettingsStore.getState().theme);

        await registerFileSystemAdapter({
          name: 'tauri',
          description: 'Native file system access via Tauri',
          supported: true,
          create: () => new TauriFileSystemAdapter(),
        });

        await registerFileSystemPicker(new TauriFilePicker());

        setIsReady(true);
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error) || 'Unknown error during initialization');
        setIsReady(true);
      }
    };

    initialize();
  }, [setTheme]);

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
      <App
        environment="tauri"
        system={isMac ? 'mac' : 'other'}
        isFullscreen={isFullscreen}
      />
    </Providers>
  );
};
