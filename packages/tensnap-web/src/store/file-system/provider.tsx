import { useEffect } from 'react';
import { FileSystemAdapter, FileSystemAdapterFactory, FileSystemPicker } from '@/types/file';
import { createFileSystemStore } from './store';
import { createUpdateTriggerStore } from '../update-trigger';

type FileSystemStore = ReturnType<typeof createFileSystemStore>;

let currentAdapter: FileSystemAdapter | null = null;
let useFileSystemStore: FileSystemStore | null = null;

let currentPicker: FileSystemPicker | null = null;

const useUpdateTriggerStore = createUpdateTriggerStore();

export const cleanupCurrentAdapter = async () => {
  if (currentAdapter) {
    await currentAdapter.cleanup();
    currentAdapter = null;
    useFileSystemStore = null;
    useUpdateTriggerStore.setState({ updateTrigger: Date.now() });
  }
};

export const registerFileSystemAdapter = async (adapterFactory: FileSystemAdapterFactory) => {
  // Cleanup current adapter if any
  await cleanupCurrentAdapter();

  const newAdapter = adapterFactory.create();
  currentAdapter = newAdapter;

  // Create new store with the adapter
  const newStore = createFileSystemStore(newAdapter, adapterFactory.name);
  if (currentPicker) {
    newStore.getState().setPicker(currentPicker);
  }
  useFileSystemStore = newStore;

  // Initialize the adapter
  await newStore.getState().initialize();

  return newAdapter;
};

export const cleanupCurrentPicker = async () => {
  if (currentPicker) {
    await currentPicker.cleanup();
    currentPicker = null;
  }
};

export const registerFileSystemPicker = async (picker: FileSystemPicker) => {
  await cleanupCurrentPicker();

  currentPicker = picker;
  useFileSystemStore?.getState().setPicker(currentPicker);

  await currentPicker.initialize();
};


export const useFileSystem = () => {
  if (!useFileSystemStore) {
    throw new Error('File system store not initialized');
  }
  useUpdateTriggerStore(store => store.updateTrigger);
  const fileSystem = useFileSystemStore();
  useEffect(() => {
    if (!fileSystem.initialized) {
      fileSystem.initialize().catch(console.error);
    }
  }, []);
  return fileSystem;
};
