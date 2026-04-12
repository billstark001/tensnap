import { openDB, DBSchema, IDBPDatabase } from 'idb';
import * as PathUtils from './utils/path';
import {
  type FileMetadata,
  type FileContent,
  type DirectoryMetadata,
  type DirectoryEntry,
  type FileSystemStats,
  type FileSystemError as FileSystemErrorType,
  FileSystemAdapter
} from '@tensnap/web/types/file';

class FileSystemError extends Error {
  public code: FileSystemErrorType['code'];
  public path?: string;
  public operation?: string;

  constructor(
    message: string,
    code: FileSystemErrorType['code'],
    path?: string,
    operation?: string
  ) {
    super(message);
    this.name = 'FileSystemError';
    this.code = code;
    this.path = path;
    this.operation = operation;
  }
}

interface FileSystemDB extends DBSchema {
  files: {
    key: string;
    value: FileContent;
    indexes: {
      'by-path': string;
      'by-parent': string;
      'by-modified': Date;
    };
  };
  directories: {
    key: string;
    value: DirectoryMetadata;
    indexes: {
      'by-path': string;
      'by-parent': string;
      'by-modified': Date;
    };
  };
  metadata: {
    key: string;
    value: any;
  };
}

export class IndexedDBFileSystemAdapter extends FileSystemAdapter {
  private db: IDBPDatabase<FileSystemDB> | null = null;
  private readonly dbName: string;
  private readonly version = 2; // Incremented for schema changes

  constructor(dbName: string = 'tensnap-filesystem') {
    super();
    this.dbName = dbName;
  }

  // 统一的错误处理装饰器
  private async safeExecute<T>(
    operation: () => Promise<T>,
    errorMessage: string,
    errorCode: FileSystemErrorType['code'] = 'STORAGE_ERROR',
    path?: string
  ): Promise<T> {
    try {
      await this.ensureInitialized();
      return await operation();
    } catch (error) {
      if (error instanceof FileSystemError) throw error;
      if (error instanceof Error && error.name === 'ConstraintError') {
        throw new FileSystemError('Path already exists', 'PATH_EXISTS', path);
      }
      throw new FileSystemError(errorMessage, errorCode, path);
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.db) {
      throw new FileSystemError('IndexedDB not initialized', 'STORAGE_ERROR');
    }
  }

  async initialize(): Promise<void> {
    if (this.db) return;

    this.db = await openDB<FileSystemDB>(this.dbName, this.version, {
      upgrade(db, oldVersion) {
        // Files store
        if (!db.objectStoreNames.contains('files')) {
          const filesStore = db.createObjectStore('files', { keyPath: 'metadata.path' });
          filesStore.createIndex('by-path', 'metadata.path', { unique: true });
          filesStore.createIndex('by-parent', 'metadata.parentPath');
          filesStore.createIndex('by-modified', 'metadata.modifiedAt');
        }

        // Directories store
        if (!db.objectStoreNames.contains('directories')) {
          const directoriesStore = db.createObjectStore('directories', { keyPath: 'path' });
          directoriesStore.createIndex('by-path', 'path', { unique: true });
          directoriesStore.createIndex('by-parent', 'parentPath');
          directoriesStore.createIndex('by-modified', 'modifiedAt');
        }

        // Metadata store
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }

        // Remove old stores if they exist (cleanup from version 1)
        if (oldVersion < 2) {
          // Safely try to delete old stores
          try {
            if ((db as any).objectStoreNames.contains('fileHistory')) {
              (db as any).deleteObjectStore('fileHistory');
            }
            if ((db as any).objectStoreNames.contains('directoryHistory')) {
              (db as any).deleteObjectStore('directoryHistory');
            }
          } catch (error) {
            // Ignore errors if stores don't exist
          }
        }
      },
    });

    await this.ensureRootDirectory();
  }

  async cleanup(): Promise<void> {
    this.db?.close();
    this.db = null;
  }

  private async ensureRootDirectory(): Promise<void> {
    const rootDir: DirectoryMetadata = {
      name: '',
      path: '/',
      parentPath: '',
      createdAt: new Date(),
      modifiedAt: new Date()
    };

    try {
      await this.db!.put('directories', rootDir);
    } catch (error) {
      // Root directory might already exist
    }
  }

  // File operations
  async writeFile(
    path: string,
    content: ArrayBuffer | string,
    metadata?: Partial<Omit<FileMetadata, 'path' | 'parentPath' | 'createdAt' | 'modifiedAt'>>
  ): Promise<FileContent> {
    return this.safeExecute(async () => {
      if (!PathUtils.validatePath(path)) {
        throw new FileSystemError('Invalid file path', 'INVALID_OPERATION', path);
      }

      const normalizedPath = PathUtils.normalizePath(path);
      const parentPath = PathUtils.getParentPath(normalizedPath);
      const fileName = normalizedPath.split('/').pop() || '';

      // Ensure parent directory exists
      if (parentPath !== '/' && !await this.directoryExists(parentPath)) {
        throw new FileSystemError(`Parent directory ${parentPath} does not exist`, 'NOT_FOUND', path);
      }

      const now = new Date();
      const checksum = PathUtils.calculateChecksum(content);
      const size = typeof content === 'string' ? new Blob([content]).size : content.byteLength;

      // Check if file exists (for updating)
      const existingFile = await this.readFile(normalizedPath);

      const fileMetadata: FileMetadata = {
        name: fileName,
        path: normalizedPath,
        parentPath,
        size,
        mimeType: metadata?.mimeType || 'application/octet-stream',
        createdAt: existingFile?.metadata.createdAt || now,
        modifiedAt: now,
        tags: metadata?.tags,
        description: metadata?.description
      };

      const file: FileContent = {
        metadata: fileMetadata,
        content,
        checksum
      };

      await this.db!.put('files', file);
      return file;
    }, 'Failed to write file', 'STORAGE_ERROR', path);
  }

  async readFile(path: string): Promise<FileContent | null> {
    return this.safeExecute(
      () => this.db!.get('files', PathUtils.normalizePath(path)).then(file => file || null),
      'Failed to read file',
      'STORAGE_ERROR',
      path
    );
  }

  async deleteFile(path: string): Promise<void> {
    return this.safeExecute(async () => {
      const normalizedPath = PathUtils.normalizePath(path);
      const file = await this.readFile(normalizedPath);

      if (!file) {
        throw new FileSystemError(`File not found at ${normalizedPath}`, 'NOT_FOUND', path);
      }

      await this.db!.delete('files', normalizedPath);
    }, 'Failed to delete file', 'STORAGE_ERROR', path);
  }

  async fileExists(path: string): Promise<boolean> {
    const normalizedPath = PathUtils.normalizePath(path);
    const file = await this.readFile(normalizedPath);
    return file !== null;
  }

  // Directory operations
  async createDirectory(path: string, allowExist = false): Promise<DirectoryMetadata> {
    return this.safeExecute(async () => {
      if (!PathUtils.validatePath(path)) {
        throw new FileSystemError('Invalid directory path', 'INVALID_OPERATION', path);
      }

      const normalizedPath = PathUtils.normalizePath(path);

      if (await this.directoryExists(normalizedPath)) {
        if (allowExist) {
          const dir = await this.db!.get('directories', normalizedPath);
          return dir!;
        }
        throw new FileSystemError(`Directory already exists at ${normalizedPath}`, 'PATH_EXISTS', path);
      }

      const parentPath = PathUtils.getParentPath(normalizedPath);
      if (parentPath !== '/' && !await this.directoryExists(parentPath)) {
        throw new FileSystemError(`Parent directory ${parentPath} does not exist`, 'NOT_FOUND', path);
      }

      const now = new Date();
      const dirName = normalizedPath.split('/').pop() || '';

      const directory: DirectoryMetadata = {
        name: dirName,
        path: normalizedPath,
        parentPath,
        createdAt: now,
        modifiedAt: now
      };

      await this.db!.put('directories', directory);
      return directory;
    }, 'Failed to create directory', 'STORAGE_ERROR', path);
  }

  async deleteDirectory(path: string, recursive = false): Promise<void> {
    return this.safeExecute(async () => {
      const normalizedPath = PathUtils.normalizePath(path);
      const directory = await this.db!.get('directories', normalizedPath);

      if (!directory) {
        throw new FileSystemError(`Directory not found at ${normalizedPath}`, 'NOT_FOUND', path);
      }

      if (normalizedPath === '/') {
        throw new FileSystemError('Cannot delete root directory', 'INVALID_OPERATION', path);
      }

      if (recursive) {
        const contents = await this.list(normalizedPath);
        for (const entry of contents) {
          if (entry.type === 'file') {
            await this.deleteFile(entry.path);
          } else {
            await this.deleteDirectory(entry.path, true);
          }
        }
      } else {
        // Check if directory is empty
        const contents = await this.list(normalizedPath);
        if (contents.length > 0) {
          throw new FileSystemError('Directory is not empty', 'INVALID_OPERATION', path);
        }
      }

      await this.db!.delete('directories', normalizedPath);
    }, 'Failed to delete directory', 'STORAGE_ERROR', path);
  }

  async list(path: string): Promise<DirectoryEntry[]> {
    return this.safeExecute(async () => {
      const normalizedPath = PathUtils.normalizePath(path);

      // Get files and directories in parallel
      const [files, directories] = await Promise.all([
        this.db!.getAllFromIndex('files', 'by-parent', normalizedPath),
        this.db!.getAllFromIndex('directories', 'by-parent', normalizedPath)
      ]);

      const entries: DirectoryEntry[] = [
        ...directories.filter(dir => dir.path !== '/').map(dir => ({ type: 'directory' as const, ...dir })),
        ...files.map(file => ({ type: 'file' as const, ...file.metadata })),
      ];

      return entries;
    }, 'Failed to list directory contents');
  }

  async directoryExists(path: string): Promise<boolean> {
    const normalizedPath = PathUtils.normalizePath(path);
    const directory = await this.db!.get('directories', normalizedPath);
    return directory !== null;
  }

  // File system operations
  async getStats(): Promise<FileSystemStats> {
    return this.safeExecute(async () => {
      const files = await this.db!.getAll('files');
      const directories = await this.db!.getAll('directories');

      const totalSize = files.reduce((sum, file) => {
        const size = typeof file.content === 'string'
          ? new Blob([file.content]).size
          : file.content.byteLength;
        return sum + size;
      }, 0);

      // Get storage quota if available
      let storageQuota: number | undefined;
      let storageUsed: number | undefined;

      if ('storage' in navigator && 'estimate' in navigator.storage) {
        try {
          const estimate = await navigator.storage.estimate();
          storageQuota = estimate.quota;
          storageUsed = estimate.usage;
        } catch (error) {
          // Ignore quota estimation errors
        }
      }

      return {
        totalFiles: files.length,
        totalDirectories: directories.length - 1, // Exclude root
        totalSize,
        storageQuota,
        storageUsed
      };
    }, 'Failed to get file system stats');
  }

}
