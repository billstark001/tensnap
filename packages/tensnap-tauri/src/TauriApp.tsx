import React, { useEffect, useState } from 'react';
import { App } from 'tensnap-web/App';
import { Providers } from 'tensnap-web/Providers';
import { TauriFileSystemAdapter, TauriFilePicker } from './adapters';
import { registerFileSystemAdapter, registerFileSystemPicker } from 'tensnap-web/store/file-system/provider';
import { initI18n } from 'tensnap-web/i18n';

export const TauriApp: React.FC = () => {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initialize = async () => {
      try {
        await initI18n();

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
      <App />
    </Providers>
  );
};
