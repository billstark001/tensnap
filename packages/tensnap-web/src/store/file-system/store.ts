import { create } from 'zustand';
import { FileSystemAdapter } from './adapter';
import {
  FileMetadata,
  FileContent,
  DirectoryMetadata,
  DirectoryEntry,
  FileSystemStats
} from '@/types/file';

export interface FileSystemState {
  // Adapter management
  adapter: FileSystemAdapter | null;
  adapterName: string;
  initialized: boolean;
  loading: boolean;
  error: string | null;

  // Current state
  currentDirectory: string;
  directoryContents: DirectoryEntry[];
  stats: FileSystemStats | null;

  // Actions
  initialize: () => Promise<void>;
  cleanup: () => Promise<void>;
  setError: (error: string | null) => void;
  clearError: () => void;
  setCurrentDirectory: (path: string) => Promise<void>;

  // File operations
  writeFile: (path: string, content: ArrayBuffer | string, metadata?: Partial<Omit<FileMetadata, 'path' | 'parentPath' | 'createdAt' | 'modifiedAt'>>) => Promise<FileContent>;
  loadFile: (path: string) => Promise<FileContent | null>;
  deleteFile: (path: string) => Promise<void>;
  moveFile: (oldPath: string, newPath: string) => Promise<FileContent>;
  copyFile: (sourcePath: string, targetPath: string) => Promise<FileContent>;
  searchFiles: (query: string, searchPath?: string, includeContent?: boolean) => Promise<(FileMetadata | DirectoryMetadata)[]>;

  // Directory operations
  createDirectory: (path: string, allowExist?: boolean) => Promise<DirectoryMetadata>;
  loadDirectory: (path: string) => Promise<DirectoryMetadata | null>;
  deleteDirectory: (path: string, recursive?: boolean) => Promise<void>;
  moveDirectory: (oldPath: string, newPath: string) => Promise<DirectoryMetadata>;
  copyDirectory: (sourcePath: string, targetPath: string) => Promise<DirectoryMetadata>;
  exportDirectory: (path: string, format?: 'zip' | 'tar' | 'json') => Promise<Blob>;
  importDirectory: (data: Blob, targetPath: string) => Promise<DirectoryMetadata>;

  // Utility operations
  refreshCurrentDirectory: () => Promise<void>;
  refreshStats: () => Promise<void>;
}

export const createFileSystemStore = (adapter: FileSystemAdapter, adapterName: string) => create<FileSystemState>((set, get) => {
  // 统一的错误处理辅助函数
  const handleError = (error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    set({ error: errorMessage });
    return errorMessage;
  };

  // 包装异步操作，统一处理加载状态和错误
  const withLoading = async <T>(
    operation: () => Promise<T>,
    shouldRefresh = false
  ): Promise<T> => {
    const { adapter } = get();
    if (!adapter) throw new Error('File system not initialized');

    set({ loading: true, error: null });
    try {
      const result = await operation();
      if (shouldRefresh) {
        await get().refreshCurrentDirectory();
      }
      set({ loading: false });
      return result;
    } catch (error) {
      const errorMessage = handleError(error);
      set({ loading: false });
      throw new Error(errorMessage);
    }
  };

  // 包装只读操作，只处理错误不处理加载状态
  const withErrorHandling = async <T>(operation: () => Promise<T>): Promise<T> => {
    const { adapter } = get();
    if (!adapter) throw new Error('File system not initialized');

    try {
      return await operation();
    } catch (error) {
      handleError(error);
      throw error;
    }
  };

  return {
    // Initial state
    adapter,
    adapterName,
    initialized: false,
    loading: false,
    error: null,
    currentDirectory: '/',
    files: [],
    directories: [],
    directoryContents: [],
    stats: null,

    // Actions
    initialize: async () => {
      if (get().initialized) return;

      set({ loading: true, error: null });
      try {
        await adapter.initialize();
        set({ initialized: true, loading: false });
        await Promise.all([
          get().refreshCurrentDirectory(),
          get().refreshStats()
        ]);
      } catch (error) {
        handleError(error);
        set({ loading: false });
      }
    },

    cleanup: async () => {
      const { adapter } = get();
      if (adapter) {
        await adapter.cleanup();
      }
      set({
        adapter: null,
        adapterName: 'none',
        initialized: false,
        currentDirectory: '/',
        directoryContents: [],
        stats: null
      });
    },

    setError: (error: string | null) => set({ error }),
    clearError: () => set({ error: null }),

    setCurrentDirectory: async (path: string) => {
      await withLoading(async () => {
        const { adapter } = get();

        if (!await adapter!.directoryExists(path)) {
          throw new Error(`Directory ${path} does not exist`);
        }

        set({ currentDirectory: path });
        await get().refreshCurrentDirectory();
      });
    },

    // File operations
    writeFile: async (path, content, metadata) => withLoading(async () => {
      const { adapter } = get();
      return await adapter!.writeFile(path, content, metadata);
    }, true),

    loadFile: (path: string) => withErrorHandling(() => get().adapter!.getFile(path)),

    deleteFile: (path: string) => withLoading(async () => {
      await get().adapter!.deleteFile(path);
    }, true),

    moveFile: (oldPath: string, newPath: string) =>
      withLoading(() => get().adapter!.moveFile(oldPath, newPath), true),

    copyFile: (sourcePath: string, targetPath: string) =>
      withLoading(() => get().adapter!.copyFile(sourcePath, targetPath), true),

    searchFiles: (query: string, searchPath?: string, includeContent?: boolean) =>
      withErrorHandling(() => get().adapter!.search(query, searchPath, includeContent)),

    // Directory operations
    createDirectory: async (path, allowExist) => withLoading(async () => {
      const { adapter } = get();
      return await adapter!.createDirectory(path, allowExist);
    }, true),

    loadDirectory: (path: string) => withErrorHandling(() => get().adapter!.getDirectory(path)),

    deleteDirectory: (path: string, recursive?: boolean) => withLoading(async () => {
      await get().adapter!.deleteDirectory(path, recursive);
    }, true),

    moveDirectory: (oldPath: string, newPath: string) =>
      withLoading(() => get().adapter!.moveDirectory(oldPath, newPath), true),

    copyDirectory: (sourcePath: string, targetPath: string) =>
      withLoading(() => get().adapter!.copyDirectory(sourcePath, targetPath), true),

    exportDirectory: (path: string, format?: 'zip' | 'tar' | 'json') =>
      withErrorHandling(() => get().adapter!.exportDirectory(path, format)),

    importDirectory: (data: Blob, targetPath: string) =>
      withLoading(() => get().adapter!.importDirectory(data, targetPath), true),

    // Utility operations
    refreshCurrentDirectory: async () => {
      const { adapter, currentDirectory } = get();
      if (!adapter) return;

      try {
        const directoryContents = await adapter.listDirectoryContents(currentDirectory);
        set({ directoryContents });
      } catch (error) {
        handleError(error);
      }
    },

    refreshStats: async () => {
      const { adapter } = get();
      if (!adapter) return;

      try {
        const stats = await adapter.getStats();
        set({ stats });
      } catch (error) {
        handleError(error);
      }
    }
  };
});
