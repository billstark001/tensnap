import React, { createContext, PropsWithChildren, useContext, useEffect, useState } from 'react';
import { FileSystemAdapter, FileSystemAdapterFactory } from './adapter';
import { IndexedDBFileSystemAdapter } from './indexeddb-adapter';
import { createFileSystemStore } from './store';

type FileSystemStore = ReturnType<typeof createFileSystemStore>;

export interface AdapterProviderProps {
  children: React.ReactNode;
  preferredAdapter?: string;
}

export interface AdapterContextValue {
  availableAdapters: FileSystemAdapterFactory[];
  currentAdapter: FileSystemAdapter | null;
  currentAdapterName: string;
  switchAdapter: (adapterName: string) => Promise<void>;
  fileSystemStore: FileSystemStore | null;
}

const AdapterContext = createContext<AdapterContextValue | null>(null);

// Available adapters
const AVAILABLE_ADAPTERS: FileSystemAdapterFactory[] = [
  {
    name: 'indexeddb',
    description: 'Browser IndexedDB storage (recommended for web)',
    supported: typeof window !== 'undefined' && 'indexedDB' in window,
    create: () => new IndexedDBFileSystemAdapter()
  },
  // Add more adapters here in the future (e.g., OPFS, remote, etc.)
];

export const AdapterProvider: React.FC<AdapterProviderProps> = ({
  children,
  preferredAdapter = 'indexeddb'
}) => {
  const [currentAdapter, setCurrentAdapter] = useState<FileSystemAdapter | null>(null);
  const [currentAdapterName, setCurrentAdapterName] = useState<string>('none');
  const [fileSystemStore, setFileSystemStore] = useState<FileSystemStore | null>(null);

  const switchAdapter = async (adapterName: string) => {
    // Cleanup current adapter if any
    if (currentAdapter) {
      await currentAdapter.cleanup();
    }

    // Find and create new adapter
    const adapterFactory = AVAILABLE_ADAPTERS.find(factory => factory.name === adapterName);
    if (!adapterFactory) {
      throw new Error(`Adapter '${adapterName}' not found`);
    }

    if (!adapterFactory.supported) {
      throw new Error(`Adapter '${adapterName}' is not supported in this environment`);
    }

    const newAdapter = adapterFactory.create();
    setCurrentAdapter(newAdapter);
    setCurrentAdapterName(adapterName);

    // Create new store with the adapter
    const newStore = createFileSystemStore(newAdapter, adapterName);
    setFileSystemStore(() => newStore);

    // Initialize the adapter
    await newStore.getState().initialize();
  };

  // Initialize with preferred adapter on mount
  useEffect(() => {
    const initializeAdapter = async () => {
      try {
        // Find a supported adapter, preferring the specified one
        let adapterToUse = preferredAdapter;
        const preferredFactory = AVAILABLE_ADAPTERS.find(factory =>
          factory.name === preferredAdapter && factory.supported
        );

        if (!preferredFactory) {
          // Fall back to first supported adapter
          const supportedFactory = AVAILABLE_ADAPTERS.find(factory => factory.supported);
          if (supportedFactory) {
            adapterToUse = supportedFactory.name;
          } else {
            console.warn('No supported file system adapters found');
            return;
          }
        }

        await switchAdapter(adapterToUse);
      } catch (error) {
        console.error('Failed to initialize file system adapter:', error);
      }
    };

    initializeAdapter();
  }, [preferredAdapter]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (currentAdapter) {
        currentAdapter.cleanup().catch(console.error);
      }
    };
  }, [currentAdapter]);

  const contextValue: AdapterContextValue = {
    availableAdapters: AVAILABLE_ADAPTERS,
    currentAdapter,
    currentAdapterName,
    switchAdapter,
    fileSystemStore
  };

  return (
    <AdapterContext.Provider value={contextValue}>
      {children}
    </AdapterContext.Provider>
  );
};

export const useAdapter = (): AdapterContextValue => {
  const context = useContext(AdapterContext);
  if (!context) {
    throw new Error('useAdapter must be used within an AdapterProvider');
  }
  return context;
};

export const UseFileSystemGuard = (props: PropsWithChildren<object>) => {
  const { fileSystemStore } = useAdapter();
  if (!fileSystemStore) {
    return <>File system store not initialized</>;
  }
  return <>{props.children}</>;
};

export const useFileSystem = () => {
  const { fileSystemStore } = useAdapter();
  if (!fileSystemStore) {
    throw new Error('File system store not initialized');
  }
  const fileSystem = fileSystemStore.getState();
  useEffect(() => {
    if (!fileSystem.initialized) {
      fileSystem.initialize().catch(console.error);
    }
  }, [fileSystem]);
  return fileSystem;
};
