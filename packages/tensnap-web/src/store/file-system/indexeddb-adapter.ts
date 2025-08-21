import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { FileSystemAdapter } from './adapter';
import { FileSystemExporter, FileSystemImporter } from './utils/export-import';
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
  fileHistory: {
    key: string;
    value: FileOperation;
    indexes: { 
      'by-file': string;
      'by-timestamp': Date;
    };
  };
  directoryHistory: {
    key: string;
    value: DirectoryOperation;
    indexes: { 
      'by-directory': string;
      'by-timestamp': Date;
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
  private readonly version = 1;
  private readonly exporter = new FileSystemExporter();
  private readonly importer = new FileSystemImporter();

  async initialize(): Promise<void> {
    if (this.db) return;

    try {
      this.db = await openDB<FileSystemDB>(this.dbName, this.version, {
        upgrade(db) {
          // Files store
          const filesStore = db.createObjectStore('files', { keyPath: 'id' });
          filesStore.createIndex('by-path', 'metadata.path', { unique: true });
          filesStore.createIndex('by-parent', 'metadata.parentPath');
          filesStore.createIndex('by-modified', 'metadata.modifiedAt');

          // Directories store
          const directoriesStore = db.createObjectStore('directories', { keyPath: 'id' });
          directoriesStore.createIndex('by-path', 'path', { unique: true });
          directoriesStore.createIndex('by-parent', 'parentPath');
          directoriesStore.createIndex('by-modified', 'modifiedAt');

          // File history store
          const fileHistoryStore = db.createObjectStore('fileHistory', { 
            keyPath: ['fileId', 'timestamp'] 
          });
          fileHistoryStore.createIndex('by-file', 'fileId');
          fileHistoryStore.createIndex('by-timestamp', 'timestamp');

          // Directory history store
          const dirHistoryStore = db.createObjectStore('directoryHistory', { 
            keyPath: ['directoryId', 'timestamp'] 
          });
          dirHistoryStore.createIndex('by-directory', 'directoryId');
          dirHistoryStore.createIndex('by-timestamp', 'timestamp');

          // Metadata store for settings and stats
          db.createObjectStore('metadata', { keyPath: 'key' });
        },
      });

      // Create root directory if it doesn't exist
      await this.ensureRootDirectory();
    } catch (error) {
      throw new FileSystemError('Failed to initialize IndexedDB', 'STORAGE_ERROR');
    }
  }

  async cleanup(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // File operations
  async createFile(
    metadata: Omit<FileMetadata, 'id' | 'createdAt' | 'modifiedAt' | 'version'>, 
    content: ArrayBuffer | string
  ): Promise<FileContent> {
    await this.ensureInitialized();
    
    if (!this.validatePath(metadata.path)) {
      throw new FileSystemError('Invalid file path', 'INVALID_OPERATION');
    }

    const normalizedPath = this.normalizePath(metadata.path);
    
    if (await this.fileExists(normalizedPath)) {
      throw new FileSystemError(`File already exists at ${normalizedPath}`, 'PATH_EXISTS');
    }

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

    try {
      const tx = this.db!.transaction(['files', 'fileHistory'], 'readwrite');
      await tx.objectStore('files').add(file);
      await this.addFileOperationTx(tx, {
        type: 'create',
        fileId: id,
        timestamp: now,
        metadata: fileMetadata
      });
      await tx.done;
      
      return file;
    } catch (error) {
      if (error instanceof Error && error.name === 'ConstraintError') {
        throw new FileSystemError(`File with path ${normalizedPath} already exists`, 'PATH_EXISTS');
      }
      throw new FileSystemError('Failed to create file', 'STORAGE_ERROR', id);
    }
  }

  async getFile(id: string): Promise<FileContent | null> {
    await this.ensureInitialized();
    
    try {
      const file = await this.db!.get('files', id);
      return file || null;
    } catch (error) {
      throw new FileSystemError('Failed to get file', 'STORAGE_ERROR', id);
    }
  }

  async getFileByPath(path: string): Promise<FileContent | null> {
    await this.ensureInitialized();
    
    try {
      const normalizedPath = this.normalizePath(path);
      const file = await this.db!.getFromIndex('files', 'by-path', normalizedPath);
      return file || null;
    } catch (error) {
      throw new FileSystemError('Failed to get file by path', 'STORAGE_ERROR');
    }
  }

  async updateFile(
    id: string, 
    content: ArrayBuffer | string, 
    metadata?: Partial<FileMetadata>
  ): Promise<FileContent> {
    await this.ensureInitialized();
    
    const existingFile = await this.getFile(id);
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

    try {
      const tx = this.db!.transaction(['files', 'fileHistory'], 'readwrite');
      await tx.objectStore('files').put(updatedFile);
      await this.addFileOperationTx(tx, {
        type: 'update',
        fileId: id,
        timestamp: now,
        metadata: updatedMetadata
      });
      await tx.done;
      
      return updatedFile;
    } catch (error) {
      throw new FileSystemError('Failed to update file', 'STORAGE_ERROR', id);
    }
  }

  async deleteFile(id: string): Promise<void> {
    await this.ensureInitialized();
    
    const file = await this.getFile(id);
    if (!file) {
      throw new FileSystemError(`File with id ${id} not found`, 'NOT_FOUND', id);
    }

    try {
      const tx = this.db!.transaction(['files', 'fileHistory'], 'readwrite');
      await tx.objectStore('files').delete(id);
      await this.addFileOperationTx(tx, {
        type: 'delete',
        fileId: id,
        timestamp: new Date()
      });
      await tx.done;
    } catch (error) {
      throw new FileSystemError('Failed to delete file', 'STORAGE_ERROR', id);
    }
  }

  async moveFile(id: string, newPath: string): Promise<FileContent> {
    const file = await this.getFile(id);
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

    try {
      const tx = this.db!.transaction(['fileHistory'], 'readwrite');
      await this.addFileOperationTx(tx, {
        type: 'move',
        fileId: id,
        timestamp: new Date(),
        oldPath,
        newPath: normalizedNewPath
      });
      await tx.done;
    } catch (error) {
      // Operation logged, but file was moved successfully
    }

    return updatedFile;
  }

  async copyFile(id: string, newPath: string): Promise<FileContent> {
    const file = await this.getFile(id);
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
    await this.ensureInitialized();
    
    try {
      const targetPath = directoryPath ? this.normalizePath(directoryPath) : '/';
      const files = await this.db!.getAllFromIndex('files', 'by-parent', targetPath);
      return files.map(file => file.metadata);
    } catch (error) {
      throw new FileSystemError('Failed to list files', 'STORAGE_ERROR');
    }
  }

  async fileExists(path: string): Promise<boolean> {
    await this.ensureInitialized();
    
    try {
      const normalizedPath = this.normalizePath(path);
      const count = await this.db!.countFromIndex('files', 'by-path', normalizedPath);
      return count > 0;
    } catch (error) {
      throw new FileSystemError('Failed to check file existence', 'STORAGE_ERROR');
    }
  }

  // Directory operations (simplified implementations)
  async createDirectory(metadata: Omit<DirectoryMetadata, 'id' | 'createdAt' | 'modifiedAt'>): Promise<DirectoryMetadata> {
    await this.ensureInitialized();
    
    if (!this.validatePath(metadata.path)) {
      throw new FileSystemError('Invalid directory path', 'INVALID_OPERATION');
    }

    const normalizedPath = this.normalizePath(metadata.path);
    
    if (await this.directoryExists(normalizedPath)) {
      throw new FileSystemError(`Directory already exists at ${normalizedPath}`, 'PATH_EXISTS');
    }

    const id = this.generateId();
    const now = new Date();
    
    const directory: DirectoryMetadata = {
      ...metadata,
      id,
      path: normalizedPath,
      parentPath: this.getParentPath(normalizedPath),
      createdAt: now,
      modifiedAt: now
    };

    try {
      await this.db!.add('directories', directory);
      return directory;
    } catch (error) {
      if (error instanceof Error && error.name === 'ConstraintError') {
        throw new FileSystemError(`Directory with path ${normalizedPath} already exists`, 'PATH_EXISTS');
      }
      throw new FileSystemError('Failed to create directory', 'STORAGE_ERROR');
    }
  }

  async getDirectory(id: string): Promise<DirectoryMetadata | null> {
    await this.ensureInitialized();
    
    try {
      const directory = await this.db!.get('directories', id);
      return directory || null;
    } catch (error) {
      throw new FileSystemError('Failed to get directory', 'STORAGE_ERROR');
    }
  }

  async getDirectoryByPath(path: string): Promise<DirectoryMetadata | null> {
    await this.ensureInitialized();
    
    try {
      const normalizedPath = this.normalizePath(path);
      const directory = await this.db!.getFromIndex('directories', 'by-path', normalizedPath);
      return directory || null;
    } catch (error) {
      throw new FileSystemError('Failed to get directory by path', 'STORAGE_ERROR');
    }
  }

  async updateDirectory(id: string, metadata: Partial<DirectoryMetadata>): Promise<DirectoryMetadata> {
    await this.ensureInitialized();
    
    const existingDirectory = await this.getDirectory(id);
    if (!existingDirectory) {
      throw new FileSystemError(`Directory with id ${id} not found`, 'NOT_FOUND');
    }

    const updatedDirectory: DirectoryMetadata = {
      ...existingDirectory,
      ...metadata,
      modifiedAt: new Date()
    };

    try {
      await this.db!.put('directories', updatedDirectory);
      return updatedDirectory;
    } catch (error) {
      throw new FileSystemError('Failed to update directory', 'STORAGE_ERROR');
    }
  }

  async deleteDirectory(id: string, recursive = false): Promise<void> {
    await this.ensureInitialized();
    
    const directory = await this.getDirectory(id);
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
      const contents = await this.listDirectoryContents(directory.path);
      for (const entry of contents) {
        if (entry.type === 'file') {
          await this.deleteFile(entry.metadata.id);
        } else {
          await this.deleteDirectory(entry.metadata.id, true);
        }
      }
    }

    try {
      await this.db!.delete('directories', id);
    } catch (error) {
      throw new FileSystemError('Failed to delete directory', 'STORAGE_ERROR');
    }
  }

  async moveDirectory(id: string, newPath: string): Promise<DirectoryMetadata> {
    // Simplified implementation - would need recursive path updates in production
    const directory = await this.getDirectory(id);
    if (!directory) {
      throw new FileSystemError(`Directory with id ${id} not found`, 'NOT_FOUND');
    }

    return await this.updateDirectory(id, {
      path: this.normalizePath(newPath),
      parentPath: this.getParentPath(this.normalizePath(newPath)),
      name: this.normalizePath(newPath).split('/').pop() || ''
    });
  }

  async copyDirectory(id: string, newPath: string): Promise<DirectoryMetadata> {
    // Simplified implementation
    const directory = await this.getDirectory(id);
    if (!directory) {
      throw new FileSystemError(`Directory with id ${id} not found`, 'NOT_FOUND');
    }

    return await this.createDirectory({
      name: this.normalizePath(newPath).split('/').pop() || '',
      path: this.normalizePath(newPath),
      parentPath: this.getParentPath(this.normalizePath(newPath)),
      description: directory.description,
      tags: directory.tags
    });
  }

  async listDirectories(parentPath?: string): Promise<DirectoryMetadata[]> {
    await this.ensureInitialized();
    
    try {
      const targetPath = parentPath ? this.normalizePath(parentPath) : '/';
      const directories = await this.db!.getAllFromIndex('directories', 'by-parent', targetPath);
      return directories.filter(dir => dir.path !== '/'); // Exclude root
    } catch (error) {
      throw new FileSystemError('Failed to list directories', 'STORAGE_ERROR');
    }
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
    await this.ensureInitialized();
    
    try {
      const normalizedPath = this.normalizePath(path);
      const count = await this.db!.countFromIndex('directories', 'by-path', normalizedPath);
      return count > 0;
    } catch (error) {
      throw new FileSystemError('Failed to check directory existence', 'STORAGE_ERROR');
    }
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
    await this.ensureInitialized();
    
    try {
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
        const estimate = await navigator.storage.estimate();
        storageQuota = estimate.quota;
        storageUsed = estimate.usage;
      }

      return {
        totalFiles: files.length,
        totalDirectories: directories.length - 1, // Exclude root
        totalSize,
        storageQuota,
        storageUsed
      };
    } catch (error) {
      throw new FileSystemError('Failed to get stats', 'STORAGE_ERROR');
    }
  }

  async getFileHistory(fileId: string): Promise<FileOperation[]> {
    await this.ensureInitialized();
    
    try {
      return await this.db!.getAllFromIndex('fileHistory', 'by-file', fileId);
    } catch (error) {
      throw new FileSystemError('Failed to get file history', 'STORAGE_ERROR', fileId);
    }
  }

  async getDirectoryHistory(directoryId: string): Promise<DirectoryOperation[]> {
    await this.ensureInitialized();
    
    try {
      return await this.db!.getAllFromIndex('directoryHistory', 'by-directory', directoryId);
    } catch (error) {
      throw new FileSystemError('Failed to get directory history', 'STORAGE_ERROR');
    }
  }

  async search(query: string, searchPath?: string, includeContent = false): Promise<(FileMetadata | DirectoryMetadata)[]> {
    await this.ensureInitialized();
    
    const lowerQuery = query.toLowerCase();
    const targetPath = searchPath ? this.normalizePath(searchPath) : undefined;
    
    const results: (FileMetadata | DirectoryMetadata)[] = [];
    
    try {
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
    } catch (error) {
      throw new FileSystemError('Failed to search', 'STORAGE_ERROR');
    }
    
    return results;
  }

  async exportDirectory(path: string, format = 'json' as 'zip' | 'tar' | 'json'): Promise<Blob> {
    await this.ensureInitialized();
    
    const normalizedPath = this.normalizePath(path);
    
    if (!await this.directoryExists(normalizedPath)) {
      throw new FileSystemError(`Directory ${normalizedPath} not found`, 'NOT_FOUND');
    }

    const directory = await this.getDirectoryByPath(normalizedPath);
    if (!directory) {
      throw new FileSystemError(`Directory ${normalizedPath} not found`, 'NOT_FOUND');
    }

    if (format === 'json') {
      return await this.exporter.exportAsJSON(
        directory,
        (dirPath: string) => this.listDirectoryContents(dirPath),
        (id: string) => this.getFile(id)
      );
    } else if (format === 'zip') {
      return await this.exporter.exportAsZip(
        directory,
        (dirPath: string) => this.listDirectoryContents(dirPath),
        (id: string) => this.getFile(id)
      );
    }
    
    throw new FileSystemError(`Export format ${format} not implemented`, 'INVALID_OPERATION');
  }

  async importDirectory(data: Blob, targetPath: string): Promise<DirectoryMetadata> {
    await this.ensureInitialized();
    
    const normalizedTargetPath = this.normalizePath(targetPath);
    
    if (await this.directoryExists(normalizedTargetPath)) {
      throw new FileSystemError(`Directory already exists at ${normalizedTargetPath}`, 'PATH_EXISTS');
    }

    // Detect format by MIME type or content
    const isZip = data.type === 'application/zip' || data.type === 'application/x-zip-compressed';
    
    if (isZip) {
      return await this.importer.importFromZip(
        data,
        (metadata: any, content: ArrayBuffer | string) => this.createFile(metadata, content),
        (metadata: any) => this.createDirectory(metadata)
      );
    } else {
      return await this.importer.importFromJSON(
        data,
        (metadata: any, content: ArrayBuffer | string) => this.createFile(metadata, content),
        (metadata: any) => this.createDirectory(metadata)
      );
    }
  }

  // Helper methods
  private async ensureInitialized(): Promise<void> {
    if (!this.db) {
      await this.initialize();
    }
  }

  private async ensureRootDirectory(): Promise<void> {
    if (!this.db) return;
    
    try {
      const rootExists = await this.directoryExists('/');
      if (!rootExists) {
        const rootDir: DirectoryMetadata = {
          id: 'root',
          name: '',
          path: '/',
          parentPath: '',
          createdAt: new Date(),
          modifiedAt: new Date()
        };
        
        await this.db.add('directories', rootDir);
      }
    } catch (error) {
      // Root directory might already exist
    }
  }

  private async addFileOperationTx(tx: any, operation: FileOperation): Promise<void> {
    await tx.objectStore('fileHistory').add(operation);
  }
}
