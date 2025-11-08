import { create } from 'zustand';
import { FileSystemAdapter } from '@/types/file';
import type {
  FileMetadata,
  FileContent,
  DirectoryMetadata,
  DirectoryEntry,
  FileSystemStats,
  FilePickerOptions,
  FileSystemPicker
} from '@/types/file';

export interface FileSystemState {
  // Adapter management
  adapter: FileSystemAdapter | null;
  adapterName: string;
  picker: FileSystemPicker | null;

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
  setPicker: (picker: FileSystemPicker | null) => void;
  pickFiles: (options?: FilePickerOptions) => Promise<FileMetadata[]>;

  writeFile: (path: string, content: ArrayBuffer | string, metadata?: Partial<Omit<FileMetadata, 'path' | 'parentPath' | 'createdAt' | 'modifiedAt'>>) => Promise<FileContent>;
  readFile: (path: string) => Promise<FileContent | null>;
  deleteFile: (path: string) => Promise<void>;

  // Directory operations
  createDirectory: (path: string, allowExist?: boolean) => Promise<DirectoryMetadata>;
  deleteDirectory: (path: string, recursive?: boolean) => Promise<void>;

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
    picker: null,
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

    setPicker(picker) {
      set({ picker });
    },

    pickFiles: async (options?: FilePickerOptions) => {
      return await withErrorHandling(() => get().picker!.pickFiles(options));
    },

    // File operations
    writeFile: async (path, content, metadata) => withLoading(async () => {
      const { adapter } = get();
      return await adapter!.writeFile(path, content, metadata);
    }, true),

    readFile: (path: string) => withErrorHandling(() => get().adapter!.readFile(path)),

    deleteFile: (path: string) => withLoading(async () => {
      await get().adapter!.deleteFile(path);
    }, true),

    // Directory operations
    createDirectory: async (path, allowExist) => withLoading(async () => {
      const { adapter } = get();
      return await adapter!.createDirectory(path, allowExist);
    }, true),

    deleteDirectory: (path: string, recursive?: boolean) => withLoading(async () => {
      await get().adapter!.deleteDirectory(path, recursive);
    }, true),

    // Utility operations
    refreshCurrentDirectory: async () => {
      const { adapter, currentDirectory } = get();
      if (!adapter) return;

      try {
        const directoryContents = await adapter.list(currentDirectory);
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
