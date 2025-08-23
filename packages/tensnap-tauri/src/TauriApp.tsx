import React from 'react';
import { App } from 'tensnap-web/App';
import { Providers } from 'tensnap-web/Providers';
import { TauriFilePickerProvider } from './components/TauriFilePickerProvider';
import { TauriFileSystemAdapter } from './adapters/tauri-adapter';

const TAURI_ADAPTERS = [
  {
    name: 'tauri',
    description: 'Native file system access via Tauri',
    supported: typeof window !== 'undefined' && '__TAURI__' in window,
    create: () => new TauriFileSystemAdapter()
  }
];

export const TauriApp: React.FC = () => {
  return (
    <Providers 
      adapterProviderProps={{
        preferredAdapter: "tauri",
        availableAdapters: TAURI_ADAPTERS
      }}
      filePickerProvider={TauriFilePickerProvider}
    >
      <App />
    </Providers>
  );
};
