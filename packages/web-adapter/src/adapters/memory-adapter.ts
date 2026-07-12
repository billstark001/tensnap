import * as PathUtils from '../utils/path';
import {
  type FileMetadata,
  type FileContent,
  type DirectoryMetadata,
  type DirectoryEntry,
  type FileSystemStats,
  type FileSystemError as FileSystemErrorType,
  FileSystemAdapter
} from '@tensnap/web-common/types/file';

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

export class MemoryFileSystemAdapter extends FileSystemAdapter {
  private files = new Map<string, FileContent>();
  private directories = new Map<string, DirectoryMetadata>();
  private initialized = false;

  private async ensureDirectoryChain(path: string): Promise<void> {
    const normalizedPath = PathUtils.normalizePath(path);
    if (!normalizedPath || normalizedPath === '/') {
      return;
    }

    const components = PathUtils.getPathComponents(normalizedPath);
    let currentPath = '';

    for (const component of components) {
      currentPath = currentPath ? `${currentPath}/${component}` : `/${component}`;
      if (this.directories.has(currentPath)) {
        continue;
      }

      const now = new Date();
      this.directories.set(currentPath, {
        name: component,
        path: currentPath,
        parentPath: PathUtils.getParentPath(currentPath),
        createdAt: now,
        modifiedAt: now,
      });
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create root directory
    const rootDir: DirectoryMetadata = {
      name: '',
      path: '/',
      parentPath: '',
      createdAt: new Date(),
      modifiedAt: new Date()
    };

    this.directories.set('/', rootDir);
    this.initialized = true;
  }

  async cleanup(): Promise<void> {
    this.files.clear();
    this.directories.clear();
    this.initialized = false;
  }

  // File operations
  async writeFile(
    path: string,
    content: ArrayBuffer | string,
    metadata?: Partial<Omit<FileMetadata, 'path' | 'parentPath' | 'createdAt' | 'modifiedAt'>>
  ): Promise<FileContent> {
    if (!PathUtils.validatePath(path)) {
      throw new FileSystemError('Invalid file path', 'INVALID_OPERATION', path);
    }

    const normalizedPath = PathUtils.normalizePath(path);
    const parentPath = PathUtils.getParentPath(normalizedPath);
    const fileName = normalizedPath.split('/').pop() || '';

    // Ensure parent directory exists
    if (parentPath && parentPath !== '/' && !await this.directoryExists(parentPath)) {
      await this.ensureDirectoryChain(parentPath);
    }

    const now = new Date();
    const checksum = PathUtils.calculateChecksum(content);
    const size = typeof content === 'string' ? new Blob([content]).size : content.byteLength;

    // Check if file exists (for updating)
    const existingFile = this.files.get(normalizedPath);

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

    this.files.set(normalizedPath, file);
    return file;
  }

  async readFile(path: string): Promise<FileContent | null> {
    const normalizedPath = PathUtils.normalizePath(path);
    return this.files.get(normalizedPath) || null;
  }

  async deleteFile(path: string): Promise<void> {
    const normalizedPath = PathUtils.normalizePath(path);
    const file = this.files.get(normalizedPath);
    if (!file) {
      throw new FileSystemError(`File not found at ${normalizedPath}`, 'NOT_FOUND', path);
    }

    this.files.delete(normalizedPath);
  }

  async fileExists(path: string): Promise<boolean> {
    const normalizedPath = PathUtils.normalizePath(path);
    return this.files.has(normalizedPath);
  }

  // Directory operations
  async createDirectory(path: string, allowExist = false): Promise<DirectoryMetadata> {
    if (!PathUtils.validatePath(path)) {
      throw new FileSystemError('Invalid directory path', 'INVALID_OPERATION', path);
    }

    const normalizedPath = PathUtils.normalizePath(path);

    if (await this.directoryExists(normalizedPath)) {
      if (allowExist) {
        return this.directories.get(normalizedPath)!;
      }
      throw new FileSystemError(`Directory already exists at ${normalizedPath}`, 'PATH_EXISTS', path);
    }

    // Ensure parent directory exists
    const parentPath = PathUtils.getParentPath(normalizedPath);
    if (parentPath && parentPath !== '/' && !await this.directoryExists(parentPath)) {
      await this.ensureDirectoryChain(parentPath);
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

    this.directories.set(normalizedPath, directory);
    return directory;
  }

  async deleteDirectory(path: string, recursive = false): Promise<void> {
    const normalizedPath = PathUtils.normalizePath(path);
    const directory = this.directories.get(normalizedPath);

    if (!directory) {
      throw new FileSystemError(`Directory not found at ${normalizedPath}`, 'NOT_FOUND', path);
    }

    if (normalizedPath === '/') {
      throw new FileSystemError('Cannot delete root directory', 'INVALID_OPERATION', path);
    }

    if (recursive) {
      // Delete all subdirectories and files
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

    this.directories.delete(normalizedPath);
  }

  async list(path: string): Promise<DirectoryEntry[]> {
    const normalizedPath = PathUtils.normalizePath(path);

    const files = Array.from(this.files.values())
      .filter(file => file.metadata.parentPath === normalizedPath)
      .map(file => file.metadata);

    const directories = Array.from(this.directories.values())
      .filter(dir => dir.parentPath === normalizedPath)
      .filter(dir => dir.path !== '/'); // Exclude root

    const entries: DirectoryEntry[] = [
      ...directories.map(dir => ({ type: 'directory' as const, ...dir })),
      ...files.map(file => ({ type: 'file' as const, ...file })),
    ];

    return entries;
  }

  async directoryExists(path: string): Promise<boolean> {
    const normalizedPath = PathUtils.normalizePath(path);
    return this.directories.has(normalizedPath);
  }

  // File system operations
  async getStats(): Promise<FileSystemStats> {
    const files = Array.from(this.files.values());
    const directories = Array.from(this.directories.values());

    const totalSize = files.reduce((sum, file) => {
      const size = typeof file.content === 'string'
        ? new Blob([file.content]).size
        : file.content.byteLength;
      return sum + size;
    }, 0);

    return {
      totalFiles: files.length,
      totalDirectories: directories.length - 1, // Exclude root
      totalSize,
      storageQuota: undefined, // Memory has no quota
      storageUsed: totalSize
    };
  }

}
