import { installNativeWindows, startNativeContent } from './workbench/native-windows';
import { useTauriFileDrop } from './hooks/useTauriFileDrop';
import React, { useCallback, useEffect, useState } from 'react';
import { App, Providers, registerDefaultModels } from '@tensnap/web';
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
import { invoke } from '@tauri-apps/api/core';
import { registerTauriLocaleCatalog } from './i18n/register-catalog';

const TauriMenuEventsLoader = () => {
  useTauriMenuEvents();
  useTauriFileDrop();
  return null;
};

configureSettingsPersistence(new TauriSettingsPersistence());
const auxiliary = new URLSearchParams(location.search).has('content');
installNativeWindows();

async function isDarkMode() {
  const theme = await getCurrentWindow().theme();
  return theme === 'dark';
}

let initialization: Promise<string> | undefined;
async function initializeTauriServices(): Promise<string> {
  registerDefaultModels();
  registerTauriLocaleCatalog();
  const osName = await getOsName();
  await hydrateSettings();
  const persistence = getSettingsPersistence();
  const [savedLocale, savedTheme] = await Promise.all([
    persistence.get('locale'),
    persistence.get('theme'),
  ]);
  const locale = detectLocale(savedLocale);
  useSettingsStore.getState().setLocale(locale);
  await initI18n(locale);
  if (savedTheme !== 'light' && savedTheme !== 'dark')
    useSettingsStore.getState().setTheme((await isDarkMode()) ? 'dark' : 'light');
  document.body.dataset.theme = useSettingsStore.getState().theme;
  await registerFileSystemAdapter({
    name: 'tauri',
    description: 'Native scoped files',
    supported: true,
    create: () => new TauriFileSystemAdapter(),
  });
  await registerFileSystemPicker(new TauriFilePicker());
  return osName;
}

export const TauriApp: React.FC = () => {
  const [isMac, setIsMac] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exitApplication = useCallback(async () => {
    await invoke('exit_application_handler');
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const window = getCurrentWindow();
    const fullscreen = await window.isFullscreen();
    await window.setFullscreen(!fullscreen);
    setIsFullscreen(!fullscreen);
  }, []);

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
    let disposed = false;
    initialization ??= initializeTauriServices();
    void initialization.then(
      (osName) => {
        if (disposed) return;
        setIsMac(osName === 'macos' || osName === 'darwin' || osName === 'macOS');
        setIsReady(true);
      },
      (error) => {
        if (!disposed) {
          setError(String(error));
          setIsReady(true);
        }
      },
    );
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!isReady || error || !auxiliary) return;
    const controller = new AbortController();
    let stop: (() => void) | undefined;
    void startNativeContent(document.getElementById('root')!, controller.signal).then(
      (dispose) => {
        if (controller.signal.aborted) dispose();
        else stop = dispose;
      },
      (error) => {
        if (!controller.signal.aborted) setError(String(error));
      },
    );
    return () => {
      controller.abort();
      stop?.();
    };
  }, [isReady, error]);

  if (isReady && !error && auxiliary) return null;

  if (!isReady) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          fontSize: '1.2rem',
          color: '#666',
        }}
      >
        Initializing...
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          fontSize: '1.2rem',
          color: '#666',
        }}
      >
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
        onExit={exitApplication}
        onToggleFullscreen={toggleFullscreen}
      />
    </Providers>
  );
};
