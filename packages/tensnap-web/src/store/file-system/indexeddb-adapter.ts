import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { FileSystemAdapter } from './adapter';
import * as PathUtils from './utils/path';
import { FileSystemExporter } from './utils/export-import';
import {
  FileMetadata,
  FileContent,
  DirectoryMetadata,
  DirectoryEntry,
  FileSystemStats,
  FileSystemError as FileSystemErrorType
} from '@/types/file';

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
  private readonly dbName = 'tensnap-filesystem';
  private readonly version = 2; // Incremented for schema changes
  private readonly exporter = new FileSystemExporter();

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
      const existingFile = await this.getFile(normalizedPath);

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

  async getFile(path: string): Promise<FileContent | null> {
    return this.safeExecute(
      () => this.db!.get('files', PathUtils.normalizePath(path)).then(file => file || null),
      'Failed to get file',
      'STORAGE_ERROR',
      path
    );
  }

  async deleteFile(path: string): Promise<void> {
    return this.safeExecute(async () => {
      const normalizedPath = PathUtils.normalizePath(path);
      const file = await this.getFile(normalizedPath);

      if (!file) {
        throw new FileSystemError(`File not found at ${normalizedPath}`, 'NOT_FOUND', path);
      }

      await this.db!.delete('files', normalizedPath);
    }, 'Failed to delete file', 'STORAGE_ERROR', path);
  }

  async moveFile(oldPath: string, newPath: string): Promise<FileContent> {
    const normalizedOldPath = PathUtils.normalizePath(oldPath);
    const normalizedNewPath = PathUtils.normalizePath(newPath);

    const file = await this.getFile(normalizedOldPath);
    if (!file) {
      throw new FileSystemError(`File not found at ${normalizedOldPath}`, 'NOT_FOUND', oldPath);
    }

    if (await this.fileExists(normalizedNewPath)) {
      throw new FileSystemError(`File already exists at ${normalizedNewPath}`, 'PATH_EXISTS', newPath);
    }

    const parentPath = PathUtils.getParentPath(normalizedNewPath);
    if (parentPath !== '/' && !await this.directoryExists(parentPath)) {
      throw new FileSystemError(`Parent directory ${parentPath} does not exist`, 'NOT_FOUND', newPath);
    }

    // Write to new location
    const updatedFile = await this.writeFile(normalizedNewPath, file.content, {
      size: file.metadata.size,
      mimeType: file.metadata.mimeType,
      tags: file.metadata.tags,
      description: file.metadata.description
    });

    // Delete from old location
    await this.deleteFile(normalizedOldPath);

    return updatedFile;
  }

  async copyFile(sourcePath: string, targetPath: string): Promise<FileContent> {
    const normalizedSourcePath = PathUtils.normalizePath(sourcePath);
    const normalizedTargetPath = PathUtils.normalizePath(targetPath);

    const file = await this.getFile(normalizedSourcePath);
    if (!file) {
      throw new FileSystemError(`File not found at ${normalizedSourcePath}`, 'NOT_FOUND', sourcePath);
    }

    if (await this.fileExists(normalizedTargetPath)) {
      throw new FileSystemError(`File already exists at ${normalizedTargetPath}`, 'PATH_EXISTS', targetPath);
    }

    return await this.writeFile(normalizedTargetPath, file.content, {
      size: file.metadata.size,
      mimeType: file.metadata.mimeType,
      tags: file.metadata.tags,
      description: file.metadata.description
    });
  }

  async listFiles(directoryPath?: string): Promise<FileMetadata[]> {
    return this.safeExecute(async () => {
      const targetPath = directoryPath ? PathUtils.normalizePath(directoryPath) : '/';
      const files = await this.db!.getAllFromIndex('files', 'by-parent', targetPath);
      return files.map(file => file.metadata);
    }, 'Failed to list files');
  }

  async fileExists(path: string): Promise<boolean> {
    const normalizedPath = PathUtils.normalizePath(path);
    const file = await this.getFile(normalizedPath);
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
          return (await this.getDirectory(normalizedPath))!;
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

  async getDirectory(path: string): Promise<DirectoryMetadata | null> {
    return this.safeExecute(
      () => this.db!.get('directories', PathUtils.normalizePath(path)).then(dir => dir || null),
      'Failed to get directory',
      'STORAGE_ERROR',
      path
    );
  }

  async deleteDirectory(path: string, recursive = false): Promise<void> {
    return this.safeExecute(async () => {
      const normalizedPath = PathUtils.normalizePath(path);
      const directory = await this.getDirectory(normalizedPath);

      if (!directory) {
        throw new FileSystemError(`Directory not found at ${normalizedPath}`, 'NOT_FOUND', path);
      }

      if (normalizedPath === '/') {
        throw new FileSystemError('Cannot delete root directory', 'INVALID_OPERATION', path);
      }

      if (!recursive && !await this.isDirectoryEmpty(normalizedPath)) {
        throw new FileSystemError('Directory is not empty', 'INVALID_OPERATION', path);
      }

      if (recursive) {
        const contents = await this.listDirectoryContents(normalizedPath);
        for (const entry of contents) {
          if (entry.type === 'file') {
            await this.deleteFile(entry.path);
          } else {
            await this.deleteDirectory(entry.path, true);
          }
        }
      }

      await this.db!.delete('directories', normalizedPath);
    }, 'Failed to delete directory', 'STORAGE_ERROR', path);
  }

  async moveDirectory(oldPath: string, newPath: string): Promise<DirectoryMetadata> {
    const normalizedOldPath = PathUtils.normalizePath(oldPath);
    const normalizedNewPath = PathUtils.normalizePath(newPath);

    const directory = await this.getDirectory(normalizedOldPath);
    if (!directory) {
      throw new FileSystemError(`Directory not found at ${normalizedOldPath}`, 'NOT_FOUND', oldPath);
    }

    if (await this.directoryExists(normalizedNewPath)) {
      throw new FileSystemError(`Directory already exists at ${normalizedNewPath}`, 'PATH_EXISTS', newPath);
    }

    // Create new directory
    const newDirectory = await this.createDirectory(normalizedNewPath);

    // Move all contents recursively
    await this.updatePathsRecursively(normalizedOldPath, normalizedNewPath);

    // Delete old directory
    await this.db!.delete('directories', normalizedOldPath);

    return newDirectory;
  }

  async copyDirectory(sourcePath: string, targetPath: string): Promise<DirectoryMetadata> {
    const normalizedSourcePath = PathUtils.normalizePath(sourcePath);
    const normalizedTargetPath = PathUtils.normalizePath(targetPath);

    const directory = await this.getDirectory(normalizedSourcePath);
    if (!directory) {
      throw new FileSystemError(`Directory not found at ${normalizedSourcePath}`, 'NOT_FOUND', sourcePath);
    }

    if (await this.directoryExists(normalizedTargetPath)) {
      throw new FileSystemError(`Directory already exists at ${normalizedTargetPath}`, 'PATH_EXISTS', targetPath);
    }

    // Create new directory
    const newDirectory = await this.createDirectory(normalizedTargetPath);

    // Copy all contents recursively
    const contents = await this.listDirectoryContents(normalizedSourcePath);
    for (const entry of contents) {
      const newEntryPath = PathUtils.joinPaths(normalizedTargetPath, entry.name);

      if (entry.type === 'file') {
        await this.copyFile(entry.path, newEntryPath);
      } else {
        await this.copyDirectory(entry.path, newEntryPath);
      }
    }

    return newDirectory;
  }

  async listDirectories(parentPath?: string): Promise<DirectoryMetadata[]> {
    return this.safeExecute(async () => {
      const targetPath = parentPath ? PathUtils.normalizePath(parentPath) : '/';
      const directories = await this.db!.getAllFromIndex('directories', 'by-parent', targetPath);
      return directories.filter(dir => dir.path !== '/'); // Exclude root
    }, 'Failed to list directories');
  }

  async listDirectoryContents(path: string): Promise<DirectoryEntry[]> {
    const normalizedPath = PathUtils.normalizePath(path);

    const files = await this.listFiles(normalizedPath);
    const directories = await this.listDirectories(normalizedPath);

    const entries: DirectoryEntry[] = [
      ...directories.map(dir => ({ type: 'directory' as const, ...dir })),
      ...files.map(file => ({ type: 'file' as const, ...file })),
    ];

    return entries;
  }

  async directoryExists(path: string): Promise<boolean> {
    const normalizedPath = PathUtils.normalizePath(path);
    const directory = await this.getDirectory(normalizedPath);
    return directory !== null;
  }

  async isDirectoryEmpty(path: string): Promise<boolean> {
    const contents = await this.listDirectoryContents(path);
    return contents.length === 0;
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

  async search(query: string, searchPath?: string, includeContent = false): Promise<(FileMetadata | DirectoryMetadata)[]> {
    return this.safeExecute(async () => {
      const lowerQuery = query.toLowerCase();
      const targetPath = searchPath ? PathUtils.normalizePath(searchPath) : undefined;

      const results: (FileMetadata | DirectoryMetadata)[] = [];

      // Search files
      const files = await this.db!.getAll('files');
      for (const file of files) {
        if (targetPath && !file.metadata.path.startsWith(targetPath)) continue;

        if (file.metadata.name.toLowerCase().includes(lowerQuery) ||
          file.metadata.path.toLowerCase().includes(lowerQuery) ||
          file.metadata.description?.toLowerCase().includes(lowerQuery) ||
          file.metadata.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))) {
          results.push(file.metadata);
        } else if (includeContent && typeof file.content === 'string') {
          if (file.content.toLowerCase().includes(lowerQuery)) {
            results.push(file.metadata);
          }
        }
      }

      // Search directories
      const directories = await this.db!.getAll('directories');
      for (const directory of directories) {
        if (directory.path === '/') continue; // Skip root
        if (targetPath && !directory.path.startsWith(targetPath)) continue;

        if (directory.name.toLowerCase().includes(lowerQuery) ||
          directory.path.toLowerCase().includes(lowerQuery) ||
          directory.description?.toLowerCase().includes(lowerQuery) ||
          directory.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))) {
          results.push(directory);
        }
      }

      return results;
    }, 'Failed to search file system');
  }

  async exportDirectory(path: string, format = 'json' as 'zip' | 'tar' | 'json'): Promise<Blob> {
    const normalizedPath = PathUtils.normalizePath(path);

    if (!await this.directoryExists(normalizedPath)) {
      throw new FileSystemError(`Directory ${normalizedPath} not found`, 'NOT_FOUND', path);
    }

    const directory = await this.getDirectory(normalizedPath);
    if (!directory) {
      throw new FileSystemError(`Directory ${normalizedPath} not found`, 'NOT_FOUND', path);
    }

    if (format === 'json') {
      return await this.exporter.exportAsJSON(
        directory,
        (dirPath) => this.listDirectoryContents(dirPath),
        (filePath) => this.getFile(filePath)
      );
    } else if (format === 'zip') {
      return await this.exporter.exportAsZip(
        directory,
        (dirPath) => this.listDirectoryContents(dirPath),
        (filePath) => this.getFile(filePath)
      );
    }

    throw new FileSystemError(`Export format ${format} not implemented`, 'INVALID_OPERATION', path);
  }

  async importDirectory(data: Blob, targetPath: string): Promise<DirectoryMetadata> {
    const normalizedTargetPath = PathUtils.normalizePath(targetPath);

    if (await this.directoryExists(normalizedTargetPath)) {
      throw new FileSystemError(`Directory already exists at ${normalizedTargetPath}`, 'PATH_EXISTS', targetPath);
    }

    const text = await data.text();
    const importData = JSON.parse(text);

    // Create directory structure recursively
    const rootDirectory = await this.createDirectory(normalizedTargetPath);
    await this.importDirectoryRecursively(importData, normalizedTargetPath);

    return rootDirectory;
  }

  private async importDirectoryRecursively(treeData: any, basePath: string): Promise<void> {
    // Import files
    for (const fileData of treeData.files || []) {
      await this.writeFile(
        PathUtils.joinPaths(basePath, fileData.metadata.name),
        fileData.content,
        {
          size: fileData.metadata.size,
          mimeType: fileData.metadata.mimeType,
          tags: fileData.metadata.tags,
          description: fileData.metadata.description
        }
      );
    }

    // Import subdirectories
    for (const subDirData of treeData.subdirectories || []) {
      const subDirPath = PathUtils.joinPaths(basePath, subDirData.directory.name);
      await this.createDirectory(subDirPath);
      await this.importDirectoryRecursively(subDirData, subDirPath);
    }
  }

  // Helper methods
  private async updatePathsRecursively(oldBasePath: string, newBasePath: string): Promise<void> {
    const tx = this.db!.transaction(['files', 'directories'], 'readwrite');

    // Update file paths
    const files = await tx.objectStore('files').getAll();
    for (const file of files) {
      if (file.metadata.path.startsWith(oldBasePath + '/')) {
        const newPath = file.metadata.path.replace(oldBasePath, newBasePath);
        await tx.objectStore('files').delete(file.metadata.path);

        const updatedFile: FileContent = {
          ...file,
          metadata: {
            ...file.metadata,
            path: newPath,
            parentPath: PathUtils.getParentPath(newPath)
          }
        };
        await tx.objectStore('files').put(updatedFile);
      }
    }

    // Update directory paths
    const directories = await tx.objectStore('directories').getAll();
    for (const directory of directories) {
      if (directory.path.startsWith(oldBasePath + '/')) {
        const newPath = directory.path.replace(oldBasePath, newBasePath);
        await tx.objectStore('directories').delete(directory.path);

        const updatedDirectory: DirectoryMetadata = {
          ...directory,
          path: newPath,
          parentPath: PathUtils.getParentPath(newPath)
        };
        await tx.objectStore('directories').put(updatedDirectory);
      }
    }

    await tx.done;
  }
}
