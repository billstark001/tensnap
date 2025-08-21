import { FileSystemAdapter } from './adapter';
import { 
  FileMetadata, 
  FileContent, 
  DirectoryMetadata,
  DirectoryEntry,
  FileSystemStats, 
  FileOperation,
  DirectoryOperation,
  FileSystemError as FileSystemErrorType
} from '../../types/file';

class FileSystemError extends Error {
  public code: FileSystemErrorType['code'];
  public fileId?: string;
  public path?: string;
  public operation?: string;

  constructor(
    message: string, 
    code: FileSystemErrorType['code'],
    fileId?: string,
    operation?: string
  ) {
    super(message);
    this.name = 'FileSystemError';
    this.code = code;
    this.fileId = fileId;
    this.operation = operation;
  }
}

export class MemoryFileSystemAdapter extends FileSystemAdapter {
  private files = new Map<string, FileContent>();
  private directories = new Map<string, DirectoryMetadata>();
  private fileHistory = new Map<string, FileOperation[]>();
  private directoryHistory = new Map<string, DirectoryOperation[]>();
  private pathToFileId = new Map<string, string>();
  private pathToDirectoryId = new Map<string, string>();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    // Create root directory
    const rootDir: DirectoryMetadata = {
      id: 'root',
      name: '',
      path: '/',
      parentPath: '',
      createdAt: new Date(),
      modifiedAt: new Date()
    };
    
    this.directories.set('root', rootDir);
    this.pathToDirectoryId.set('/', 'root');
    this.initialized = true;
  }

  async cleanup(): Promise<void> {
    this.files.clear();
    this.directories.clear();
    this.fileHistory.clear();
    this.directoryHistory.clear();
    this.pathToFileId.clear();
    this.pathToDirectoryId.clear();
    this.initialized = false;
  }

  // File operations
  async createFile(
    metadata: Omit<FileMetadata, 'id' | 'createdAt' | 'modifiedAt' | 'version'>, 
    content: ArrayBuffer | string
  ): Promise<FileContent> {
    if (!this.validatePath(metadata.path)) {
      throw new FileSystemError('Invalid file path', 'INVALID_OPERATION');
    }

    const normalizedPath = this.normalizePath(metadata.path);
    
    if (await this.fileExists(normalizedPath)) {
      throw new FileSystemError(`File already exists at ${normalizedPath}`, 'PATH_EXISTS');
    }

    // Ensure parent directory exists
    const parentPath = this.getParentPath(normalizedPath);
    if (parentPath !== '/' && !await this.directoryExists(parentPath)) {
      throw new FileSystemError(`Parent directory ${parentPath} does not exist`, 'NOT_FOUND');
    }

    const id = this.generateId();
    const now = new Date();
    const checksum = this.calculateChecksum(content);
    
    const fileMetadata: FileMetadata = {
      ...metadata,
      id,
      path: normalizedPath,
      parentPath,
      createdAt: now,
      modifiedAt: now,
      version: 1
    };

    const file: FileContent = {
      id,
      metadata: fileMetadata,
      content,
      checksum
    };

    this.files.set(id, file);
    this.pathToFileId.set(normalizedPath, id);
    this.addFileOperation({
      type: 'create',
      fileId: id,
      timestamp: now,
      metadata: fileMetadata
    });

    return file;
  }

  async getFile(id: string): Promise<FileContent | null> {
    return this.files.get(id) || null;
  }

  async getFileByPath(path: string): Promise<FileContent | null> {
    const normalizedPath = this.normalizePath(path);
    const fileId = this.pathToFileId.get(normalizedPath);
    return fileId ? await this.getFile(fileId) : null;
  }

  async updateFile(
    id: string, 
    content: ArrayBuffer | string, 
    metadata?: Partial<FileMetadata>
  ): Promise<FileContent> {
    const existingFile = this.files.get(id);
    if (!existingFile) {
      throw new FileSystemError(`File with id ${id} not found`, 'NOT_FOUND', id);
    }

    const now = new Date();
    const checksum = this.calculateChecksum(content);
    
    const updatedMetadata: FileMetadata = {
      ...existingFile.metadata,
      ...metadata,
      modifiedAt: now,
      version: existingFile.metadata.version + 1
    };

    const updatedFile: FileContent = {
      ...existingFile,
      metadata: updatedMetadata,
      content,
      checksum
    };

    this.files.set(id, updatedFile);
    this.addFileOperation({
      type: 'update',
      fileId: id,
      timestamp: now,
      metadata: updatedMetadata
    });

    return updatedFile;
  }

  async deleteFile(id: string): Promise<void> {
    const file = this.files.get(id);
    if (!file) {
      throw new FileSystemError(`File with id ${id} not found`, 'NOT_FOUND', id);
    }

    this.files.delete(id);
    this.pathToFileId.delete(file.metadata.path);
    this.addFileOperation({
      type: 'delete',
      fileId: id,
      timestamp: new Date()
    });
  }

  async moveFile(id: string, newPath: string): Promise<FileContent> {
    const file = this.files.get(id);
    if (!file) {
      throw new FileSystemError(`File with id ${id} not found`, 'NOT_FOUND', id);
    }

    const normalizedNewPath = this.normalizePath(newPath);
    
    if (await this.fileExists(normalizedNewPath)) {
      throw new FileSystemError(`File already exists at ${normalizedNewPath}`, 'PATH_EXISTS');
    }

    const oldPath = file.metadata.path;
    const parentPath = this.getParentPath(normalizedNewPath);
    
    if (parentPath !== '/' && !await this.directoryExists(parentPath)) {
      throw new FileSystemError(`Parent directory ${parentPath} does not exist`, 'NOT_FOUND');
    }

    const updatedFile = await this.updateFile(id, file.content, {
      path: normalizedNewPath,
      parentPath,
      name: normalizedNewPath.split('/').pop() || ''
    });

    this.pathToFileId.delete(oldPath);
    this.pathToFileId.set(normalizedNewPath, id);

    this.addFileOperation({
      type: 'move',
      fileId: id,
      timestamp: new Date(),
      oldPath,
      newPath: normalizedNewPath
    });

    return updatedFile;
  }

  async copyFile(id: string, newPath: string): Promise<FileContent> {
    const file = this.files.get(id);
    if (!file) {
      throw new FileSystemError(`File with id ${id} not found`, 'NOT_FOUND', id);
    }

    const normalizedNewPath = this.normalizePath(newPath);
    
    if (await this.fileExists(normalizedNewPath)) {
      throw new FileSystemError(`File already exists at ${normalizedNewPath}`, 'PATH_EXISTS');
    }

    return await this.createFile({
      name: normalizedNewPath.split('/').pop() || '',
      path: normalizedNewPath,
      parentPath: this.getParentPath(normalizedNewPath),
      size: file.metadata.size,
      mimeType: file.metadata.mimeType,
      tags: file.metadata.tags,
      description: file.metadata.description
    }, file.content);
  }

  async listFiles(directoryPath?: string): Promise<FileMetadata[]> {
    const targetPath = directoryPath ? this.normalizePath(directoryPath) : '/';
    
    return Array.from(this.files.values())
      .filter(file => file.metadata.parentPath === targetPath)
      .map(file => file.metadata);
  }

  async fileExists(path: string): Promise<boolean> {
    const normalizedPath = this.normalizePath(path);
    return this.pathToFileId.has(normalizedPath);
  }

  // Directory operations
  async createDirectory(
    metadata: Omit<DirectoryMetadata, 'id' | 'createdAt' | 'modifiedAt'>
  ): Promise<DirectoryMetadata> {
    if (!this.validatePath(metadata.path)) {
      throw new FileSystemError('Invalid directory path', 'INVALID_OPERATION');
    }

    const normalizedPath = this.normalizePath(metadata.path);
    
    if (await this.directoryExists(normalizedPath)) {
      throw new FileSystemError(`Directory already exists at ${normalizedPath}`, 'PATH_EXISTS');
    }

    // Ensure parent directory exists
    const parentPath = this.getParentPath(normalizedPath);
    if (parentPath !== '/' && !await this.directoryExists(parentPath)) {
      throw new FileSystemError(`Parent directory ${parentPath} does not exist`, 'NOT_FOUND');
    }

    const id = this.generateId();
    const now = new Date();
    
    const directory: DirectoryMetadata = {
      ...metadata,
      id,
      path: normalizedPath,
      parentPath,
      createdAt: now,
      modifiedAt: now
    };

    this.directories.set(id, directory);
    this.pathToDirectoryId.set(normalizedPath, id);
    this.addDirectoryOperation({
      type: 'create',
      directoryId: id,
      timestamp: now,
      metadata: directory
    });

    return directory;
  }

  async getDirectory(id: string): Promise<DirectoryMetadata | null> {
    return this.directories.get(id) || null;
  }

  async getDirectoryByPath(path: string): Promise<DirectoryMetadata | null> {
    const normalizedPath = this.normalizePath(path);
    const directoryId = this.pathToDirectoryId.get(normalizedPath);
    return directoryId ? await this.getDirectory(directoryId) : null;
  }

  async updateDirectory(id: string, metadata: Partial<DirectoryMetadata>): Promise<DirectoryMetadata> {
    const existingDirectory = this.directories.get(id);
    if (!existingDirectory) {
      throw new FileSystemError(`Directory with id ${id} not found`, 'NOT_FOUND');
    }

    const updatedDirectory: DirectoryMetadata = {
      ...existingDirectory,
      ...metadata,
      modifiedAt: new Date()
    };

    this.directories.set(id, updatedDirectory);
    this.addDirectoryOperation({
      type: 'rename',
      directoryId: id,
      timestamp: new Date(),
      metadata: updatedDirectory
    });

    return updatedDirectory;
  }

  async deleteDirectory(id: string, recursive = false): Promise<void> {
    const directory = this.directories.get(id);
    if (!directory) {
      throw new FileSystemError(`Directory with id ${id} not found`, 'NOT_FOUND');
    }

    if (directory.path === '/') {
      throw new FileSystemError('Cannot delete root directory', 'INVALID_OPERATION');
    }

    if (!recursive && !await this.isDirectoryEmpty(directory.path)) {
      throw new FileSystemError('Directory is not empty', 'INVALID_OPERATION');
    }

    if (recursive) {
      // Delete all subdirectories and files
      const contents = await this.listDirectoryContents(directory.path);
      for (const entry of contents) {
        if (entry.type === 'file') {
          await this.deleteFile(entry.metadata.id);
        } else {
          await this.deleteDirectory(entry.metadata.id, true);
        }
      }
    }

    this.directories.delete(id);
    this.pathToDirectoryId.delete(directory.path);
    this.addDirectoryOperation({
      type: 'delete',
      directoryId: id,
      timestamp: new Date()
    });
  }

  async moveDirectory(id: string, newPath: string): Promise<DirectoryMetadata> {
    const directory = this.directories.get(id);
    if (!directory) {
      throw new FileSystemError(`Directory with id ${id} not found`, 'NOT_FOUND');
    }

    const normalizedNewPath = this.normalizePath(newPath);
    
    if (await this.directoryExists(normalizedNewPath)) {
      throw new FileSystemError(`Directory already exists at ${normalizedNewPath}`, 'PATH_EXISTS');
    }

    const oldPath = directory.path;
    
    // Update directory path
    const updatedDirectory = await this.updateDirectory(id, {
      path: normalizedNewPath,
      parentPath: this.getParentPath(normalizedNewPath),
      name: normalizedNewPath.split('/').pop() || ''
    });

    this.pathToDirectoryId.delete(oldPath);
    this.pathToDirectoryId.set(normalizedNewPath, id);

    // Update all contained files and directories
    await this.updatePathsRecursively(oldPath, normalizedNewPath);

    this.addDirectoryOperation({
      type: 'move',
      directoryId: id,
      timestamp: new Date(),
      oldPath,
      newPath: normalizedNewPath
    });

    return updatedDirectory;
  }

  async copyDirectory(id: string, newPath: string): Promise<DirectoryMetadata> {
    const directory = this.directories.get(id);
    if (!directory) {
      throw new FileSystemError(`Directory with id ${id} not found`, 'NOT_FOUND');
    }

    const normalizedNewPath = this.normalizePath(newPath);
    
    if (await this.directoryExists(normalizedNewPath)) {
      throw new FileSystemError(`Directory already exists at ${normalizedNewPath}`, 'PATH_EXISTS');
    }

    // Create new directory
    const newDirectory = await this.createDirectory({
      name: normalizedNewPath.split('/').pop() || '',
      path: normalizedNewPath,
      parentPath: this.getParentPath(normalizedNewPath),
      description: directory.description,
      tags: directory.tags
    });

    // Copy all contents recursively
    const contents = await this.listDirectoryContents(directory.path);
    for (const entry of contents) {
      const newEntryPath = this.joinPaths(normalizedNewPath, entry.metadata.name);
      
      if (entry.type === 'file') {
        await this.copyFile(entry.metadata.id, newEntryPath);
      } else {
        await this.copyDirectory(entry.metadata.id, newEntryPath);
      }
    }

    return newDirectory;
  }

  async listDirectories(parentPath?: string): Promise<DirectoryMetadata[]> {
    const targetPath = parentPath ? this.normalizePath(parentPath) : '/';
    
    return Array.from(this.directories.values())
      .filter(dir => dir.parentPath === targetPath)
      .filter(dir => dir.path !== '/'); // Exclude root
  }

  async listDirectoryContents(path: string): Promise<DirectoryEntry[]> {
    const normalizedPath = this.normalizePath(path);
    
    const files = await this.listFiles(normalizedPath);
    const directories = await this.listDirectories(normalizedPath);
    
    const entries: DirectoryEntry[] = [
      ...files.map(file => ({ type: 'file' as const, metadata: file })),
      ...directories.map(dir => ({ type: 'directory' as const, metadata: dir }))
    ];

    return entries;
  }

  async directoryExists(path: string): Promise<boolean> {
    const normalizedPath = this.normalizePath(path);
    return this.pathToDirectoryId.has(normalizedPath);
  }

  async isDirectoryEmpty(path: string): Promise<boolean> {
    const contents = await this.listDirectoryContents(path);
    return contents.length === 0;
  }

  // Path operations
  resolvePath(path: string): string {
    return this.normalizePath(path);
  }

  getParentPath(path: string): string {
    const normalized = this.normalizePath(path);
    if (normalized === '/') return '';
    
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash <= 0 ? '/' : normalized.substring(0, lastSlash);
  }

  joinPaths(...paths: string[]): string {
    return this.normalizePath(paths.join('/'));
  }

  getPathDepth(path: string): number {
    const normalized = this.normalizePath(path);
    return normalized === '/' ? 0 : normalized.split('/').length - 1;
  }

  getPathComponents(path: string): string[] {
    const normalized = this.normalizePath(path);
    return normalized === '/' ? [] : normalized.split('/').filter(Boolean);
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

  async getFileHistory(fileId: string): Promise<FileOperation[]> {
    return this.fileHistory.get(fileId) || [];
  }

  async getDirectoryHistory(directoryId: string): Promise<DirectoryOperation[]> {
    return this.directoryHistory.get(directoryId) || [];
  }

  async search(query: string, searchPath?: string, includeContent = false): Promise<(FileMetadata | DirectoryMetadata)[]> {
    const lowerQuery = query.toLowerCase();
    const targetPath = searchPath ? this.normalizePath(searchPath) : undefined;
    
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
    const normalizedPath = this.normalizePath(path);
    
    if (!await this.directoryExists(normalizedPath)) {
      throw new FileSystemError(`Directory ${normalizedPath} not found`, 'NOT_FOUND');
    }

    const exportData = await this.buildDirectoryTree(normalizedPath);
    
    if (format === 'json') {
      return new Blob([JSON.stringify(exportData, null, 2)], { 
        type: 'application/json' 
      });
    }
    
    // TODO: Implement zip/tar formats
    throw new FileSystemError(`Export format ${format} not implemented`, 'INVALID_OPERATION');
  }

  async importDirectory(data: Blob, targetPath: string): Promise<DirectoryMetadata> {
    const normalizedTargetPath = this.normalizePath(targetPath);
    
    if (await this.directoryExists(normalizedTargetPath)) {
      throw new FileSystemError(`Directory already exists at ${normalizedTargetPath}`, 'PATH_EXISTS');
    }

    const text = await data.text();
    const importData = JSON.parse(text);
    
    // Create directory structure recursively
    const rootDirectory = await this.createDirectory({
      name: normalizedTargetPath.split('/').pop() || '',
      path: normalizedTargetPath,
      parentPath: this.getParentPath(normalizedTargetPath)
    });

    await this.importDirectoryRecursively(importData, normalizedTargetPath);
    
    return rootDirectory;
  }

  // Helper methods
  private addFileOperation(operation: FileOperation): void {
    const history = this.fileHistory.get(operation.fileId) || [];
    history.push(operation);
    this.fileHistory.set(operation.fileId, history);
  }

  private addDirectoryOperation(operation: DirectoryOperation): void {
    const history = this.directoryHistory.get(operation.directoryId) || [];
    history.push(operation);
    this.directoryHistory.set(operation.directoryId, history);
  }

  private async updatePathsRecursively(oldBasePath: string, newBasePath: string): Promise<void> {
    // Update file paths
    for (const [path, fileId] of this.pathToFileId.entries()) {
      if (path.startsWith(oldBasePath + '/')) {
        const newPath = path.replace(oldBasePath, newBasePath);
        const file = this.files.get(fileId);
        if (file) {
          await this.updateFile(fileId, file.content, {
            path: newPath,
            parentPath: this.getParentPath(newPath)
          });
          this.pathToFileId.delete(path);
          this.pathToFileId.set(newPath, fileId);
        }
      }
    }

    // Update directory paths
    for (const [path, directoryId] of this.pathToDirectoryId.entries()) {
      if (path.startsWith(oldBasePath + '/')) {
        const newPath = path.replace(oldBasePath, newBasePath);
        await this.updateDirectory(directoryId, {
          path: newPath,
          parentPath: this.getParentPath(newPath)
        });
        this.pathToDirectoryId.delete(path);
        this.pathToDirectoryId.set(newPath, directoryId);
      }
    }
  }

  private async buildDirectoryTree(path: string): Promise<any> {
    const directory = await this.getDirectoryByPath(path);
    if (!directory) return null;

    const contents = await this.listDirectoryContents(path);
    const tree: any = {
      directory,
      files: [],
      subdirectories: []
    };

    for (const entry of contents) {
      if (entry.type === 'file') {
        const file = await this.getFile(entry.metadata.id);
        if (file) {
          tree.files.push(file);
        }
      } else {
        const subTree = await this.buildDirectoryTree(entry.metadata.path);
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
      await this.createFile({
        name: fileData.metadata.name,
        path: this.joinPaths(basePath, fileData.metadata.name),
        parentPath: basePath,
        size: fileData.metadata.size,
        mimeType: fileData.metadata.mimeType,
        tags: fileData.metadata.tags,
        description: fileData.metadata.description
      }, fileData.content);
    }

    // Import subdirectories
    for (const subDirData of treeData.subdirectories || []) {
      const subDirPath = this.joinPaths(basePath, subDirData.directory.name);
      await this.createDirectory({
        name: subDirData.directory.name,
        path: subDirPath,
        parentPath: basePath,
        description: subDirData.directory.description,
        tags: subDirData.directory.tags
      });
      
      await this.importDirectoryRecursively(subDirData, subDirPath);
    }
  }
}
