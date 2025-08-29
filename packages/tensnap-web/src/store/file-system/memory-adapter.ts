import { FileSystemAdapter } from './adapter';
import * as PathUtils from './utils/path';
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

export class MemoryFileSystemAdapter extends FileSystemAdapter {
  private files = new Map<string, FileContent>();
  private directories = new Map<string, DirectoryMetadata>();
  private initialized = false;

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
    if (parentPath !== '/' && !await this.directoryExists(parentPath)) {
      throw new FileSystemError(`Parent directory ${parentPath} does not exist`, 'NOT_FOUND', path);
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

  async getFile(path: string): Promise<FileContent | null> {
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

  async moveFile(oldPath: string, newPath: string): Promise<FileContent> {
    const normalizedOldPath = PathUtils.normalizePath(oldPath);
    const normalizedNewPath = PathUtils.normalizePath(newPath);

    const file = this.files.get(normalizedOldPath);
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

    // Update file metadata
    const updatedFile = await this.writeFile(normalizedNewPath, file.content, {
      name: normalizedNewPath.split('/').pop() || '',
      size: file.metadata.size,
      mimeType: file.metadata.mimeType,
      tags: file.metadata.tags,
      description: file.metadata.description
    });

    this.files.delete(normalizedOldPath);
    return updatedFile;
  }

  async copyFile(sourcePath: string, targetPath: string): Promise<FileContent> {
    const normalizedSourcePath = PathUtils.normalizePath(sourcePath);
    const normalizedTargetPath = PathUtils.normalizePath(targetPath);

    const file = this.files.get(normalizedSourcePath);
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
    const targetPath = directoryPath ? PathUtils.normalizePath(directoryPath) : '/';

    return Array.from(this.files.values())
      .filter(file => file.metadata.parentPath === targetPath)
      .map(file => file.metadata);
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

    this.directories.set(normalizedPath, directory);
    return directory;
  }

  async getDirectory(path: string): Promise<DirectoryMetadata | null> {
    const normalizedPath = PathUtils.normalizePath(path);
    return this.directories.get(normalizedPath) || null;
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

    if (!recursive && !await this.isDirectoryEmpty(normalizedPath)) {
      throw new FileSystemError('Directory is not empty', 'INVALID_OPERATION', path);
    }

    if (recursive) {
      // Delete all subdirectories and files
      const contents = await this.listDirectoryContents(normalizedPath);
      for (const entry of contents) {
        if (entry.type === 'file') {
          await this.deleteFile(entry.path);
        } else {
          await this.deleteDirectory(entry.path, true);
        }
      }
    }

    this.directories.delete(normalizedPath);
  }

  async moveDirectory(oldPath: string, newPath: string): Promise<DirectoryMetadata> {
    const normalizedOldPath = PathUtils.normalizePath(oldPath);
    const normalizedNewPath = PathUtils.normalizePath(newPath);

    const directory = this.directories.get(normalizedOldPath);
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
    this.directories.delete(normalizedOldPath);

    return newDirectory;
  }

  async copyDirectory(sourcePath: string, targetPath: string): Promise<DirectoryMetadata> {
    const normalizedSourcePath = PathUtils.normalizePath(sourcePath);
    const normalizedTargetPath = PathUtils.normalizePath(targetPath);

    const directory = this.directories.get(normalizedSourcePath);
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
    const targetPath = parentPath ? PathUtils.normalizePath(parentPath) : '/';

    return Array.from(this.directories.values())
      .filter(dir => dir.parentPath === targetPath)
      .filter(dir => dir.path !== '/'); // Exclude root
  }

  async listDirectoryContents(path: string): Promise<DirectoryEntry[]> {
    const normalizedPath = PathUtils.normalizePath(path);

    const files = await this.listFiles(normalizedPath);
    const directories = await this.listDirectories(normalizedPath);

    const entries: DirectoryEntry[] = [
      ...directories.map(dir => ({ type: 'directory' as const, ...dir, })),
      ...files.map(file => ({ type: 'file' as const, ...file, })),
    ];

    return entries;
  }

  async directoryExists(path: string): Promise<boolean> {
    const normalizedPath = PathUtils.normalizePath(path);
    return this.directories.has(normalizedPath);
  }

  async isDirectoryEmpty(path: string): Promise<boolean> {
    const contents = await this.listDirectoryContents(path);
    return contents.length === 0;
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

  async search(query: string, searchPath?: string, includeContent = false): Promise<(FileMetadata | DirectoryMetadata)[]> {
    const lowerQuery = query.toLowerCase();
    const targetPath = searchPath ? PathUtils.normalizePath(searchPath) : undefined;

    const results: (FileMetadata | DirectoryMetadata)[] = [];

    // Search files
    for (const file of this.files.values()) {
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
    for (const directory of this.directories.values()) {
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
  }

  async exportDirectory(path: string, format = 'json' as 'zip' | 'tar' | 'json'): Promise<Blob> {
    const normalizedPath = PathUtils.normalizePath(path);

    if (!await this.directoryExists(normalizedPath)) {
      throw new FileSystemError(`Directory ${normalizedPath} not found`, 'NOT_FOUND', path);
    }

    const exportData = await this.buildDirectoryTree(normalizedPath);

    if (format === 'json') {
      return new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json'
      });
    }

    // TODO: Implement zip/tar formats
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

  // Helper methods
  private async updatePathsRecursively(oldBasePath: string, newBasePath: string): Promise<void> {
    // Update file paths
    const filesToUpdate: [string, FileContent][] = [];
    for (const [path, file] of this.files.entries()) {
      if (path.startsWith(oldBasePath + '/')) {
        const newPath = path.replace(oldBasePath, newBasePath);
        filesToUpdate.push([newPath, { ...file, metadata: { ...file.metadata, path: newPath, parentPath: PathUtils.getParentPath(newPath) } }]);
        this.files.delete(path);
      }
    }

    for (const [newPath, file] of filesToUpdate) {
      this.files.set(newPath, file);
    }

    // Update directory paths
    const directoriesToUpdate: [string, DirectoryMetadata][] = [];
    for (const [path, directory] of this.directories.entries()) {
      if (path.startsWith(oldBasePath + '/')) {
        const newPath = path.replace(oldBasePath, newBasePath);
        directoriesToUpdate.push([newPath, { ...directory, path: newPath, parentPath: PathUtils.getParentPath(newPath) }]);
        this.directories.delete(path);
      }
    }

    for (const [newPath, directory] of directoriesToUpdate) {
      this.directories.set(newPath, directory);
    }
  }

  private async buildDirectoryTree(path: string): Promise<any> {
    const directory = await this.getDirectory(path);
    if (!directory) return null;

    const contents = await this.listDirectoryContents(path);
    const tree: any = {
      directory,
      files: [],
      subdirectories: []
    };

    for (const entry of contents) {
      if (entry.type === 'file') {
        const file = await this.getFile(entry.path);
        if (file) {
          tree.files.push(file);
        }
      } else {
        const subTree = await this.buildDirectoryTree(entry.path);
        if (subTree) {
          tree.subdirectories.push(subTree);
        }
      }
    }

    return tree;
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
}
