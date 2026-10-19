import { FileSystemError } from './file-system-error';
import { validateMove } from './move-utils';
import * as PathUtils from '../utils/path';
import {
  type FileMetadata,
  type FileContent,
  type DirectoryMetadata,
  type DirectoryEntry,
  type FileSystemStats,
  FileSystemAdapter,
} from '@tensnap/web-common/types/file';

export class MemoryFileSystemAdapter extends FileSystemAdapter {
  private files = new Map<string, FileContent>();
  private directories = new Map<string, DirectoryMetadata>();
  private initialized = false;

  private ensureDirectoryChain(path: string): void {
    const normalizedPath = PathUtils.normalizePath(path);
    if (!normalizedPath || normalizedPath === '/') {
      return;
    }

    const components = PathUtils.getPathComponents(normalizedPath);
    let currentPath = '';

    for (const component of components) {
      currentPath = currentPath ? `${currentPath}/${component}` : `/${component}`;
      if (this.files.has(currentPath)) {
        throw new FileSystemError(
          'A file blocks the directory path',
          'INVALID_OPERATION',
          currentPath,
        );
      }
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
      modifiedAt: new Date(),
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
    metadata?: Partial<Omit<FileMetadata, 'path' | 'parentPath' | 'createdAt' | 'modifiedAt'>>,
  ): Promise<FileContent> {
    if (!PathUtils.validatePath(path)) {
      throw new FileSystemError('Invalid file path', 'INVALID_OPERATION', path);
    }

    const normalizedPath = PathUtils.normalizePath(path);
    const parentPath = PathUtils.getParentPath(normalizedPath);
    if (this.directories.has(normalizedPath)) {
      throw new FileSystemError('Cannot write a file over a directory', 'INVALID_OPERATION', path);
    }
    const fileName = normalizedPath.split('/').pop() || '';

    // Ensure parent directory exists
    if (parentPath && parentPath !== '/' && !this.directories.has(parentPath)) {
      this.ensureDirectoryChain(parentPath);
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
      description: metadata?.description,
    };

    const file: FileContent = {
      metadata: fileMetadata,
      content,
      checksum,
    };

    this.files.set(normalizedPath, structuredClone(file));
    return file;
  }

  async readFile(path: string): Promise<FileContent | null> {
    const normalizedPath = PathUtils.normalizePath(path);
    const file = this.files.get(normalizedPath);
    return file ? structuredClone(file) : null;
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

  override async move(sourcePath: string, targetPath: string): Promise<void> {
    const { source, target } = await validateMove(this, sourcePath, targetPath);
    if (source === target) return;
    const relocate = <T extends DirectoryMetadata>(metadata: T): T => {
      const path = target + metadata.path.slice(source.length);
      return {
        ...metadata,
        path,
        name: PathUtils.getBaseName(path),
        parentPath: PathUtils.getParentPath(path),
      };
    };
    for (const [path, file] of [...this.files]) {
      if (path !== source && !path.startsWith(`${source}/`)) continue;
      const metadata = relocate(file.metadata);
      this.files.set(metadata.path, { ...file, metadata });
      this.files.delete(path);
    }
    for (const [path, directory] of [...this.directories]) {
      if (path !== source && !path.startsWith(`${source}/`)) continue;
      const metadata = relocate(directory);
      this.directories.set(metadata.path, metadata);
      this.directories.delete(path);
    }
  }

  // Directory operations
  async createDirectory(path: string, allowExist = false): Promise<DirectoryMetadata> {
    if (!PathUtils.validatePath(path)) {
      throw new FileSystemError('Invalid directory path', 'INVALID_OPERATION', path);
    }

    const normalizedPath = PathUtils.normalizePath(path);

    if (this.files.has(normalizedPath)) {
      throw new FileSystemError('A file already exists at this path', 'PATH_EXISTS', path);
    }
    if (this.directories.has(normalizedPath)) {
      if (allowExist) {
        return structuredClone(this.directories.get(normalizedPath)!);
      }
      throw new FileSystemError(
        `Directory already exists at ${normalizedPath}`,
        'PATH_EXISTS',
        path,
      );
    }

    // Ensure parent directory exists
    const parentPath = PathUtils.getParentPath(normalizedPath);
    if (parentPath && parentPath !== '/' && !this.directories.has(parentPath)) {
      this.ensureDirectoryChain(parentPath);
    }

    const now = new Date();
    const dirName = normalizedPath.split('/').pop() || '';

    const directory: DirectoryMetadata = {
      name: dirName,
      path: normalizedPath,
      parentPath,
      createdAt: now,
      modifiedAt: now,
    };

    this.directories.set(normalizedPath, structuredClone(directory));
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

    const prefix = `${normalizedPath}/`;
    if (recursive) {
      // Scan each map once: walking and listing every nested directory repeatedly
      // scans the whole filesystem and becomes quadratic for deep directory trees.
      for (const filePath of this.files.keys()) {
        if (filePath.startsWith(prefix)) this.files.delete(filePath);
      }
      for (const directoryPath of this.directories.keys()) {
        if (directoryPath.startsWith(prefix)) this.directories.delete(directoryPath);
      }
    } else {
      for (const entries of [this.files, this.directories]) {
        for (const entryPath of entries.keys()) {
          if (entryPath.startsWith(prefix)) {
            throw new FileSystemError('Directory is not empty', 'INVALID_OPERATION', path);
          }
        }
      }
    }

    this.directories.delete(normalizedPath);
  }

  async list(path: string): Promise<DirectoryEntry[]> {
    const normalizedPath = PathUtils.normalizePath(path);

    const files = Array.from(this.files.values())
      .filter((file) => file.metadata.parentPath === normalizedPath)
      .map((file) => file.metadata);

    const directories = Array.from(this.directories.values())
      .filter((dir) => dir.parentPath === normalizedPath)
      .filter((dir) => dir.path !== '/'); // Exclude root

    const entries: DirectoryEntry[] = [
      ...directories.map((dir) => ({ type: 'directory' as const, ...dir })),
      ...files.map((file) => ({ type: 'file' as const, ...file })),
    ];

    return structuredClone(entries);
  }

  async directoryExists(path: string): Promise<boolean> {
    const normalizedPath = PathUtils.normalizePath(path);
    return this.directories.has(normalizedPath);
  }

  // File system operations
  async getStats(): Promise<FileSystemStats> {
    let totalSize = 0;
    for (const file of this.files.values()) totalSize += file.metadata.size;

    return {
      totalFiles: this.files.size,
      totalDirectories: Math.max(0, this.directories.size - 1), // Exclude root
      totalSize,
      storageQuota: undefined, // Memory has no quota
      storageUsed: totalSize,
    };
  }
}
