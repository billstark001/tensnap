import { create } from 'zustand';
import { FileSystemAdapter } from './adapter';
import {
  FileMetadata,
  FileContent,
  DirectoryMetadata,
  DirectoryEntry,
  FileSystemStats,
  FileOperation,
  DirectoryOperation
} from '../../types/file';

export interface FileSystemState {
  // Adapter management
  adapter: FileSystemAdapter | null;
  adapterName: string;
  initialized: boolean;
  loading: boolean;
  error: string | null;

  // Current state
  currentDirectory: string;
  files: FileMetadata[];
  directories: DirectoryMetadata[];
  directoryContents: DirectoryEntry[];
  stats: FileSystemStats | null;

  // Actions
  initialize: () => Promise<void>;
  cleanup: () => Promise<void>;
  setError: (error: string | null) => void;
  clearError: () => void;
  setCurrentDirectory: (path: string) => Promise<void>;

  // File operations
  createFile: (metadata: Omit<FileMetadata, 'id' | 'createdAt' | 'modifiedAt' | 'version'>, content: ArrayBuffer | string) => Promise<FileContent>;
  loadFile: (id: string) => Promise<FileContent | null>;
  loadFileByPath: (path: string) => Promise<FileContent | null>;
  updateFile: (id: string, content: ArrayBuffer | string, metadata?: Partial<FileMetadata>) => Promise<FileContent>;
  deleteFile: (id: string) => Promise<void>;
  moveFile: (id: string, newPath: string) => Promise<FileContent>;
  copyFile: (id: string, newPath: string) => Promise<FileContent>;
  searchFiles: (query: string, searchPath?: string, includeContent?: boolean) => Promise<(FileMetadata | DirectoryMetadata)[]>;
  getFileHistory: (fileId: string) => Promise<FileOperation[]>;

  // Directory operations
  createDirectory: (metadata: Omit<DirectoryMetadata, 'id' | 'createdAt' | 'modifiedAt'>) => Promise<DirectoryMetadata>;
  loadDirectory: (id: string) => Promise<DirectoryMetadata | null>;
  loadDirectoryByPath: (path: string) => Promise<DirectoryMetadata | null>;
  updateDirectory: (id: string, metadata: Partial<DirectoryMetadata>) => Promise<DirectoryMetadata>;
  deleteDirectory: (id: string, recursive?: boolean) => Promise<void>;
  moveDirectory: (id: string, newPath: string) => Promise<DirectoryMetadata>;
  copyDirectory: (id: string, newPath: string) => Promise<DirectoryMetadata>;
  getDirectoryHistory: (directoryId: string) => Promise<DirectoryOperation[]>;
  exportDirectory: (path: string, format?: 'zip' | 'tar' | 'json') => Promise<Blob>;
  importDirectory: (data: Blob, targetPath: string) => Promise<DirectoryMetadata>;

  // Utility operations
  refreshCurrentDirectory: () => Promise<void>;
  refreshStats: () => Promise<void>;
}

export const createFileSystemStore = (adapter: FileSystemAdapter, adapterName: string) => create<FileSystemState>((set, get) => ({
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

      set({
        initialized: true,
        loading: false
      });

      // Load initial data
      await get().refreshCurrentDirectory();
      await get().refreshStats();
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        loading: false
      });
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
      files: [],
      directories: [],
      directoryContents: [],
      stats: null
    });
  },

  setError: (error: string | null) => set({ error }),
  clearError: () => set({ error: null }),

  setCurrentDirectory: async (path: string) => {
    const { adapter } = get();
    if (!adapter) throw new Error('File system not initialized');

    set({ loading: true, error: null });
    try {
      const normalizedPath = adapter.resolvePath(path);

      if (!await adapter.directoryExists(normalizedPath)) {
        throw new Error(`Directory ${normalizedPath} does not exist`);
      }

      set({ currentDirectory: normalizedPath });
      await get().refreshCurrentDirectory();
      set({ loading: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      set({ error: errorMessage, loading: false });
      throw error;
    }
  },

  // File operations
  createFile: async (metadata, content) => {
    const { adapter, currentDirectory } = get();
    if (!adapter) throw new Error('File system not initialized');

    set({ loading: true, error: null });
    try {
      // If no path specified, create in current directory
      const filePath = metadata.path || adapter.joinPaths(currentDirectory, metadata.name);

      const file = await adapter.createFile({
        ...metadata,
        path: filePath,
        parentPath: adapter.getParentPath(filePath)
      }, content);

      await get().refreshCurrentDirectory();
      set({ loading: false });
      return file;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      set({ error: errorMessage, loading: false });
      throw error;
    }
  },

  loadFile: async (id: string) => {
    const { adapter } = get();
    if (!adapter) throw new Error('File system not initialized');

    try {
      return await adapter.getFile(id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      set({ error: errorMessage });
      throw error;
    }
  },

  loadFileByPath: async (path: string) => {
    const { adapter } = get();
    if (!adapter) throw new Error('File system not initialized');

    try {
      return await adapter.getFileByPath(path);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      set({ error: errorMessage });
      throw error;
    }
  },

  updateFile: async (id: string, content: ArrayBuffer | string, metadata?: Partial<FileMetadata>) => {
    const { adapter } = get();
    if (!adapter) throw new Error('File system not initialized');

    set({ loading: true, error: null });
    try {
      const file = await adapter.updateFile(id, content, metadata);
      await get().refreshCurrentDirectory();
      set({ loading: false });
      return file;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      set({ error: errorMessage, loading: false });
      throw error;
    }
  },

  deleteFile: async (id: string) => {
    const { adapter } = get();
    if (!adapter) throw new Error('File system not initialized');

    set({ loading: true, error: null });
    try {
      await adapter.deleteFile(id);
      await get().refreshCurrentDirectory();
      set({ loading: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      set({ error: errorMessage, loading: false });
      throw error;
    }
  },

  moveFile: async (id: string, newPath: string) => {
    const { adapter } = get();
    if (!adapter) throw new Error('File system not initialized');

    set({ loading: true, error: null });
    try {
      const file = await adapter.moveFile(id, newPath);
      await get().refreshCurrentDirectory();
      set({ loading: false });
      return file;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      set({ error: errorMessage, loading: false });
      throw error;
    }
  },

  copyFile: async (id: string, newPath: string) => {
    const { adapter } = get();
    if (!adapter) throw new Error('File system not initialized');

    set({ loading: true, error: null });
    try {
      const file = await adapter.copyFile(id, newPath);
      await get().refreshCurrentDirectory();
      set({ loading: false });
      return file;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      set({ error: errorMessage, loading: false });
      throw error;
    }
  },

  searchFiles: async (query: string, searchPath?: string, includeContent = false) => {
    const { adapter, currentDirectory } = get();
    if (!adapter) throw new Error('File system not initialized');

    try {
      const searchDir = searchPath || currentDirectory;
      return await adapter.search(query, searchDir, includeContent);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      set({ error: errorMessage });
      throw error;
    }
  },

  getFileHistory: async (fileId: string) => {
    const { adapter } = get();
    if (!adapter) throw new Error('File system not initialized');

    try {
      return await adapter.getFileHistory(fileId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      set({ error: errorMessage });
      throw error;
    }
  },

  // Directory operations
  createDirectory: async (metadata) => {
    const { adapter, currentDirectory } = get();
    if (!adapter) throw new Error('File system not initialized');

    set({ loading: true, error: null });
    try {
      // If no path specified, create in current directory
      const dirPath = metadata.path || adapter.joinPaths(currentDirectory, metadata.name);

      const directory = await adapter.createDirectory({
        ...metadata,
        path: dirPath,
        parentPath: adapter.getParentPath(dirPath)
      });

      await get().refreshCurrentDirectory();
      set({ loading: false });
      return directory;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      set({ error: errorMessage, loading: false });
      throw error;
    }
  },

  loadDirectory: async (id: string) => {
    const { adapter } = get();
    if (!adapter) throw new Error('File system not initialized');

    try {
      return await adapter.getDirectory(id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      set({ error: errorMessage });
      throw error;
    }
  },

  loadDirectoryByPath: async (path: string) => {
    const { adapter } = get();
    if (!adapter) throw new Error('File system not initialized');

    try {
      return await adapter.getDirectoryByPath(path);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      set({ error: errorMessage });
      throw error;
    }
  },

  updateDirectory: async (id: string, metadata: Partial<DirectoryMetadata>) => {
    const { adapter } = get();
    if (!adapter) throw new Error('File system not initialized');

    set({ loading: true, error: null });
    try {
      const directory = await adapter.updateDirectory(id, metadata);
      await get().refreshCurrentDirectory();
      set({ loading: false });
      return directory;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      set({ error: errorMessage, loading: false });
      throw error;
    }
  },

  deleteDirectory: async (id: string, recursive = false) => {
    const { adapter } = get();
    if (!adapter) throw new Error('File system not initialized');

    set({ loading: true, error: null });
    try {
      await adapter.deleteDirectory(id, recursive);
      await get().refreshCurrentDirectory();
      set({ loading: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      set({ error: errorMessage, loading: false });
      throw error;
    }
  },

  moveDirectory: async (id: string, newPath: string) => {
    const { adapter } = get();
    if (!adapter) throw new Error('File system not initialized');

    set({ loading: true, error: null });
    try {
      const directory = await adapter.moveDirectory(id, newPath);
      await get().refreshCurrentDirectory();
      set({ loading: false });
      return directory;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      set({ error: errorMessage, loading: false });
      throw error;
    }
  },

  copyDirectory: async (id: string, newPath: string) => {
    const { adapter } = get();
    if (!adapter) throw new Error('File system not initialized');

    set({ loading: true, error: null });
    try {
      const directory = await adapter.copyDirectory(id, newPath);
      await get().refreshCurrentDirectory();
      set({ loading: false });
      return directory;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      set({ error: errorMessage, loading: false });
      throw error;
    }
  },

  getDirectoryHistory: async (directoryId: string) => {
    const { adapter } = get();
    if (!adapter) throw new Error('File system not initialized');

    try {
      return await adapter.getDirectoryHistory(directoryId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      set({ error: errorMessage });
      throw error;
    }
  },

  exportDirectory: async (path: string, format = 'json' as 'zip' | 'tar' | 'json') => {
    const { adapter } = get();
    if (!adapter) throw new Error('File system not initialized');

    set({ loading: true, error: null });
    try {
      const blob = await adapter.exportDirectory(path, format);
      set({ loading: false });
      return blob;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      set({ error: errorMessage, loading: false });
      throw error;
    }
  },

  importDirectory: async (data: Blob, targetPath: string) => {
    const { adapter } = get();
    if (!adapter) throw new Error('File system not initialized');

    set({ loading: true, error: null });
    try {
      const directory = await adapter.importDirectory(data, targetPath);
      await get().refreshCurrentDirectory();
      set({ loading: false });
      return directory;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      set({ error: errorMessage, loading: false });
      throw error;
    }
  },

  // Utility operations
  refreshCurrentDirectory: async () => {
    const { adapter, currentDirectory } = get();
    if (!adapter) throw new Error('File system not initialized');

    try {
      const [files, directories, directoryContents] = await Promise.all([
        adapter.listFiles(currentDirectory),
        adapter.listDirectories(currentDirectory),
        adapter.listDirectoryContents(currentDirectory)
      ]);

      set({ files, directories, directoryContents });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      set({ error: errorMessage });
    }
  },

  refreshStats: async () => {
    const { adapter } = get();
    if (!adapter) throw new Error('File system not initialized');

    try {
      const stats = await adapter.getStats();
      set({ stats });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      set({ error: errorMessage });
    }
  },
}));
