import LightningFS from '@isomorphic-git/lightning-fs';
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

type ContentType = 'text' | 'binary';

interface PersistedFileMeta {
  createdAt: string;
  mimeType: string;
  tags?: string[];
  description?: string;
  contentType: ContentType;
}

interface PersistedDirMeta {
  createdAt: string;
}

interface PersistedMetadata {
  files: Record<string, PersistedFileMeta>;
  directories: Record<string, PersistedDirMeta>;
}

const METADATA_FILE_PATH = '/.tensnap-meta.json';
const DEFAULT_MIME_TYPE = 'application/octet-stream';

function inferMimeType(path: string): string {
  const normalizedPath = path.toLowerCase();
  if (normalizedPath.endsWith('.json')) return 'application/json';
  if (normalizedPath.endsWith('.md')) return 'text/markdown';
  if (normalizedPath.endsWith('.txt')) return 'text/plain';
  if (normalizedPath.endsWith('.csv')) return 'text/csv';
  if (normalizedPath.endsWith('.yaml') || normalizedPath.endsWith('.yml')) return 'application/x-yaml';
  return DEFAULT_MIME_TYPE;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return Uint8Array.from(data).buffer;
}

function toFileSystemError(
  error: unknown,
  fallbackMessage: string,
  path?: string,
  operation?: string,
): FileSystemError {
  const fsError = error as Error & { code?: string };
  const code = fsError?.code;

  if (code === 'EEXIST') {
    return new FileSystemError('Path already exists', 'PATH_EXISTS', path, operation);
  }
  if (code === 'ENOENT') {
    return new FileSystemError('Path not found', 'NOT_FOUND', path, operation);
  }
  if (code === 'ENOTEMPTY') {
    return new FileSystemError('Directory is not empty', 'INVALID_OPERATION', path, operation);
  }
  if (code === 'ENOTDIR' || code === 'EISDIR') {
    return new FileSystemError('Invalid path type for operation', 'INVALID_OPERATION', path, operation);
  }

  return new FileSystemError(fallbackMessage, 'STORAGE_ERROR', path, operation);
}

export class IndexedDBFileSystemAdapter extends FileSystemAdapter {
  private fs: InstanceType<typeof LightningFS> | null = null;
  private metadata: PersistedMetadata = { files: {}, directories: {} };
  private readonly dbName: string;

  constructor(dbName: string = 'tensnap-filesystem') {
    super();
    this.dbName = dbName;
  }

  private isMissingObjectStoreError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    const maybeError = error as { name?: string; message?: string };
    if (maybeError.name === 'NotFoundError') {
      return true;
    }

    return /object stores? (was )?not found/i.test(maybeError.message ?? '');
  }

  private deleteIndexedDB(databaseName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        resolve();
        return;
      }

      const request = indexedDB.deleteDatabase(databaseName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error(`Failed to delete IndexedDB database: ${databaseName}`));
      request.onblocked = () => {
        // Best-effort cleanup. If another tab blocks deletion, continue and let retry decide.
        resolve();
      };
    });
  }

  private async recoverCorruptedLightningFSState(): Promise<void> {
    this.fs = null;
    this.metadata = { files: {}, directories: {} };

    await Promise.allSettled([
      this.deleteIndexedDB(this.dbName),
      this.deleteIndexedDB(`${this.dbName}_lock`),
    ]);
  }

  private async bootstrapFileSystem(): Promise<void> {
    this.fs = new LightningFS(this.dbName);
    try {
      await this.fsPromises.mkdir('/');
    } catch {
      // Root already exists.
    }

    await this.loadMetadata();

    if (!this.metadata.directories['/']) {
      this.metadata.directories['/'] = { createdAt: new Date().toISOString() };
      await this.persistMetadata();
    }
  }

  private async safeExecute<T>(
    operation: () => Promise<T>,
    errorMessage: string,
    errorCode: FileSystemErrorType['code'] = 'STORAGE_ERROR',
    path?: string,
    operationName?: string,
  ): Promise<T> {
    try {
      await this.ensureInitialized();
      return await operation();
    } catch (error) {
      if (error instanceof FileSystemError) throw error;
      if (errorCode !== 'STORAGE_ERROR') {
        throw new FileSystemError(errorMessage, errorCode, path, operationName);
      }
      throw toFileSystemError(error, errorMessage, path, operationName);
    }
  }

  private ensureInitialized(): void {
    if (!this.fs) {
      throw new FileSystemError('IndexedDB filesystem not initialized', 'STORAGE_ERROR');
    }
  }

  private get fsPromises(): InstanceType<typeof LightningFS>['promises'] {
    this.ensureInitialized();
    return this.fs!.promises;
  }

  private async loadMetadata(): Promise<void> {
    try {
      const raw = await this.fsPromises.readFile(METADATA_FILE_PATH, 'utf8');
      const parsed = JSON.parse(raw) as PersistedMetadata;
      this.metadata = {
        files: parsed.files ?? {},
        directories: parsed.directories ?? {},
      };
    } catch {
      this.metadata = { files: {}, directories: {} };
      await this.persistMetadata();
    }
  }

  private async persistMetadata(): Promise<void> {
    const payload = JSON.stringify(this.metadata);
    await this.fsPromises.writeFile(METADATA_FILE_PATH, payload, 'utf8');
  }

  private createFileMetadata(path: string, stat: { size: number; mtimeMs: number }): FileMetadata {
    const parentPath = PathUtils.getParentPath(path);
    const name = path.split('/').pop() || '';
    const persisted = this.metadata.files[path];
    const createdAt = persisted?.createdAt ? new Date(persisted.createdAt) : new Date(stat.mtimeMs);
    const modifiedAt = new Date(stat.mtimeMs);

    return {
      name,
      path,
      parentPath,
      size: stat.size,
      mimeType: persisted?.mimeType ?? inferMimeType(path),
      createdAt,
      modifiedAt,
      tags: persisted?.tags,
      description: persisted?.description,
    };
  }

  private createDirectoryMetadata(path: string, stat: { mtimeMs: number }): DirectoryMetadata {
    const parentPath = PathUtils.getParentPath(path);
    const name = path.split('/').pop() || '';
    const persisted = this.metadata.directories[path];
    const createdAt = persisted?.createdAt ? new Date(persisted.createdAt) : new Date(stat.mtimeMs);
    const modifiedAt = new Date(stat.mtimeMs);

    return {
      name,
      path,
      parentPath,
      createdAt,
      modifiedAt,
    };
  }

  private async collectEntries(path: string): Promise<DirectoryEntry[]> {
    const normalizedPath = PathUtils.normalizePath(path);
    const names = await this.fsPromises.readdir(normalizedPath);

    const entries = await Promise.all(
      names.map(async (name) => {
        const childPath = normalizedPath === '/' ? `/${name}` : `${normalizedPath}/${name}`;

        if (childPath === METADATA_FILE_PATH) {
          return null;
        }

        const stat = await this.fsPromises.stat(childPath);
        if (stat.isDirectory()) {
          return {
            type: 'directory' as const,
            ...this.createDirectoryMetadata(childPath, stat),
          };
        }

        return {
          type: 'file' as const,
          ...this.createFileMetadata(childPath, stat),
        };
      }),
    );

    return entries.filter((entry): entry is DirectoryEntry => entry !== null);
  }

  private async ensureDirectoryChain(path: string): Promise<void> {
    const normalizedPath = PathUtils.normalizePath(path);
    if (!normalizedPath || normalizedPath === '/') {
      return;
    }

    const components = PathUtils.getPathComponents(normalizedPath);
    let currentPath = '';

    for (const component of components) {
      currentPath = currentPath ? `${currentPath}/${component}` : `/${component}`;
      if (await this.directoryExists(currentPath)) {
        continue;
      }
      await this.fsPromises.mkdir(currentPath);
      this.metadata.directories[currentPath] = {
        createdAt: this.metadata.directories[currentPath]?.createdAt ?? new Date().toISOString(),
      };
    }
  }

  private async walk(path: string): Promise<DirectoryEntry[]> {
    const directEntries = await this.collectEntries(path);
    const nested = await Promise.all(
      directEntries
        .filter((entry) => entry.type === 'directory')
        .map((entry) => this.walk(entry.path)),
    );

    return [...directEntries, ...nested.flat()];
  }

  async initialize(): Promise<void> {
    if (this.fs) return;

    try {
      await this.bootstrapFileSystem();
    } catch (error) {
      if (!this.isMissingObjectStoreError(error)) {
        this.fs = null;
        throw error;
      }

      await this.recoverCorruptedLightningFSState();
      try {
        await this.bootstrapFileSystem();
      } catch (retryError) {
        this.fs = null;

        if (this.isMissingObjectStoreError(retryError)) {
          throw new FileSystemError(
            'IndexedDB schema is incompatible. Please close other tabs of this app and retry.',
            'STORAGE_ERROR',
            undefined,
            'initialize',
          );
        }

        throw retryError;
      }
    }
  }

  async cleanup(): Promise<void> {
    if (this.fs) {
      await this.persistMetadata();
      await this.fs.promises.flush();
    }
    this.fs = null;
    this.metadata = { files: {}, directories: {} };
  }

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

      if (parentPath && parentPath !== '/' && !await this.directoryExists(parentPath)) {
        await this.ensureDirectoryChain(parentPath);
      }

      const existingCreatedAt = this.metadata.files[normalizedPath]?.createdAt;
      const contentType: ContentType = typeof content === 'string' ? 'text' : 'binary';
      const writable = typeof content === 'string' ? content : new Uint8Array(content);

      await this.fsPromises.writeFile(normalizedPath, writable);
      const stat = await this.fsPromises.stat(normalizedPath);

      this.metadata.files[normalizedPath] = {
        createdAt: existingCreatedAt ?? new Date().toISOString(),
        mimeType: metadata?.mimeType || inferMimeType(normalizedPath),
        tags: metadata?.tags,
        description: metadata?.description,
        contentType,
      };
      await this.persistMetadata();

      const fileMetadata = this.createFileMetadata(normalizedPath, stat);
      const storedContent = contentType === 'text'
        ? await this.fsPromises.readFile(normalizedPath, 'utf8')
        : toArrayBuffer(await this.fsPromises.readFile(normalizedPath));

      return {
        metadata: fileMetadata,
        content: storedContent,
        checksum: PathUtils.calculateChecksum(storedContent),
      };
    }, 'Failed to write file', 'STORAGE_ERROR', path, 'writeFile');
  }

  async readFile(path: string): Promise<FileContent | null> {
    return this.safeExecute(async () => {
      const normalizedPath = PathUtils.normalizePath(path);

      try {
        const fileMeta = this.metadata.files[normalizedPath];
        const contentType = fileMeta?.contentType ?? 'binary';

        const content = contentType === 'text'
          ? await this.fsPromises.readFile(normalizedPath, 'utf8')
          : toArrayBuffer(await this.fsPromises.readFile(normalizedPath));
        const stat = await this.fsPromises.stat(normalizedPath);
        const metadata = this.createFileMetadata(normalizedPath, stat);

        return {
          metadata,
          content,
          checksum: PathUtils.calculateChecksum(content),
        };
      } catch (error) {
        const fsError = error as Error & { code?: string };
        if (fsError?.code === 'ENOENT') {
          return null;
        }
        throw error;
      }
    }, 'Failed to read file', 'STORAGE_ERROR', path, 'readFile');
  }

  async deleteFile(path: string): Promise<void> {
    return this.safeExecute(async () => {
      const normalizedPath = PathUtils.normalizePath(path);

      await this.fsPromises.unlink(normalizedPath);
      delete this.metadata.files[normalizedPath];
      await this.persistMetadata();
    }, 'Failed to delete file', 'STORAGE_ERROR', path, 'deleteFile');
  }

  async fileExists(path: string): Promise<boolean> {
    const normalizedPath = PathUtils.normalizePath(path);
    try {
      const stat = await this.fsPromises.stat(normalizedPath);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  async createDirectory(path: string, allowExist = false): Promise<DirectoryMetadata> {
    return this.safeExecute(async () => {
      if (!PathUtils.validatePath(path)) {
        throw new FileSystemError('Invalid directory path', 'INVALID_OPERATION', path);
      }

      const normalizedPath = PathUtils.normalizePath(path);

      if (await this.directoryExists(normalizedPath)) {
        if (allowExist) {
          const stat = await this.fsPromises.stat(normalizedPath);
          return this.createDirectoryMetadata(normalizedPath, stat);
        }
        throw new FileSystemError(`Directory already exists at ${normalizedPath}`, 'PATH_EXISTS', path);
      }

      const parentPath = PathUtils.getParentPath(normalizedPath);
      if (parentPath && parentPath !== '/' && !await this.directoryExists(parentPath)) {
        await this.ensureDirectoryChain(parentPath);
      }

      await this.fsPromises.mkdir(normalizedPath);
      const stat = await this.fsPromises.stat(normalizedPath);

      this.metadata.directories[normalizedPath] = {
        createdAt: this.metadata.directories[normalizedPath]?.createdAt ?? new Date().toISOString(),
      };
      await this.persistMetadata();

      return this.createDirectoryMetadata(normalizedPath, stat);
    }, 'Failed to create directory', 'STORAGE_ERROR', path, 'createDirectory');
  }

  async deleteDirectory(path: string, recursive = false): Promise<void> {
    return this.safeExecute(async () => {
      const normalizedPath = PathUtils.normalizePath(path);
      if (!await this.directoryExists(normalizedPath)) {
        throw new FileSystemError(`Directory not found at ${normalizedPath}`, 'NOT_FOUND', path);
      }

      if (normalizedPath === '/') {
        throw new FileSystemError('Cannot delete root directory', 'INVALID_OPERATION', path);
      }

      if (recursive) {
        const contents = await this.walk(normalizedPath);
        contents.sort((a, b) => b.path.length - a.path.length);

        for (const entry of contents) {
          if (entry.type === 'file') {
            await this.deleteFile(entry.path);
          } else {
            await this.fsPromises.rmdir(entry.path);
            delete this.metadata.directories[entry.path];
          }
        }

        await this.fsPromises.rmdir(normalizedPath);
      } else {
        const contents = await this.collectEntries(normalizedPath);
        if (contents.length > 0) {
          throw new FileSystemError('Directory is not empty', 'INVALID_OPERATION', path);
        }
        await this.fsPromises.rmdir(normalizedPath);
      }

      delete this.metadata.directories[normalizedPath];
      await this.persistMetadata();
    }, 'Failed to delete directory', 'STORAGE_ERROR', path, 'deleteDirectory');
  }

  async list(path: string): Promise<DirectoryEntry[]> {
    return this.safeExecute(
      () => this.collectEntries(path),
      'Failed to list directory contents',
      'STORAGE_ERROR',
      path,
      'list',
    );
  }

  async directoryExists(path: string): Promise<boolean> {
    const normalizedPath = PathUtils.normalizePath(path);
    try {
      const stat = await this.fsPromises.stat(normalizedPath);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  async getStats(): Promise<FileSystemStats> {
    return this.safeExecute(async () => {
      const allEntries = await this.walk('/');
      const files = allEntries.filter((entry) => entry.type === 'file');
      const directories = allEntries.filter((entry) => entry.type === 'directory');
      const totalSize = files.reduce((sum, file) => sum + file.size, 0);

      let storageQuota: number | undefined;
      let storageUsed: number | undefined;

      if ('storage' in navigator && 'estimate' in navigator.storage) {
        try {
          const estimate = await navigator.storage.estimate();
          storageQuota = estimate.quota;
          storageUsed = estimate.usage;
        } catch {
          // Ignore quota estimation errors.
        }
      }

      return {
        totalFiles: files.length,
        totalDirectories: directories.length,
        totalSize,
        storageQuota,
        storageUsed
      };
    }, 'Failed to get file system stats', 'STORAGE_ERROR', undefined, 'getStats');
  }
}
