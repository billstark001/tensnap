// Re-export main components
export { App } from './src/App';
export { Providers } from './src/Providers';

// Re-export file types specifically
export type {
  FileMetadata,
  FileContent,
  DirectoryMetadata,
  DirectoryEntry,
  FileSystemStats
} from './src/types/file';

// Re-export store
export { FileSystemAdapter } from './src/store/file-system/adapter';
export type { FileSystemAdapterFactory } from './src/store/file-system/adapter';
export { AdapterProvider } from './src/store/file-system/provider';
export type { AdapterProviderProps } from './src/store/file-system/provider';

// Re-export components
export { FilePickerProvider, useFilePicker } from './src/components/file-system';
