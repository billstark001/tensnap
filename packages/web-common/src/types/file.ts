export interface BaseMetadata {
  name: string;
  path: string;
  createdAt: Date;
  modifiedAt: Date;
  parentPath: string;
  description?: string;
  tags?: string[];
}

export interface FileMetadata extends BaseMetadata {
  size: number;
  mimeType: string;
}

export interface FileContent {
  metadata: FileMetadata;
  content: ArrayBuffer | string;
  checksum: string;
}

export interface DirectoryMetadata extends BaseMetadata {}

export type DirectoryEntry =
  | ({ type: 'file' } & FileMetadata)
  | ({ type: 'directory' } & DirectoryMetadata);

export interface FileSystemStats {
  totalFiles: number;
  totalDirectories: number;
  totalSize: number;
  lastBackup?: Date;
  storageQuota?: number;
  storageUsed?: number;
}

export interface FileSystemError extends Error {
  code:
    | 'NOT_FOUND'
    | 'PERMISSION_DENIED'
    | 'QUOTA_EXCEEDED'
    | 'INVALID_OPERATION'
    | 'STORAGE_ERROR'
    | 'PATH_EXISTS';
  path?: string;
  operation?: string;
}

export interface FilePickerOptions {
  title?: string;
  multiSelect?: boolean;
  mode?: 'open' | 'save';
  allowUpload?: boolean;
  /** File types offered by native save/open dialogs. */
  filters?: Array<{ name: string; extensions: string[] }>;
  /** Suggested final filename. Native dialogs grant this exact returned path. */
  defaultPath?: string;
}

/**
 * Simplified FileSystem Adapter Interface
 * Only includes essential operations: read, write, delete, list, and stat
 */
export abstract class FileSystemAdapter {
  abstract initialize(): Promise<void>;
  abstract cleanup(): Promise<void>;

  /** Persist content and metadata independently of subsequent caller mutations. */
  abstract writeFile(
    path: string,
    content: ArrayBuffer | string,
    metadata?: Partial<Omit<FileMetadata, 'path' | 'parentPath' | 'createdAt' | 'modifiedAt'>>,
  ): Promise<FileContent>;
  /** Return detached content/metadata, or null when the file is absent. */
  abstract readFile(path: string): Promise<FileContent | null>;
  abstract deleteFile(path: string): Promise<void>;

  /** Move or rename an entry without replacing an existing destination.
   * Browser adapters implement this; other hosts may keep their native file UI.
   */
  move(_sourcePath: string, _targetPath: string): Promise<void> {
    return Promise.reject(new Error('Moving entries is not supported by this filesystem'));
  }

  // Essential directory operations
  abstract createDirectory(path: string, allowExist?: boolean): Promise<DirectoryMetadata>;
  abstract deleteDirectory(path: string, recursive?: boolean): Promise<void>;

  /** Return detached metadata for the immediate files and directories in a path. */
  abstract list(path: string): Promise<DirectoryEntry[]>;

  // Essential stat operations
  abstract getStats(): Promise<FileSystemStats>;
  abstract fileExists(path: string): Promise<boolean>;
  abstract directoryExists(path: string): Promise<boolean>;
}

export abstract class FileSystemPicker {
  abstract initialize(): Promise<void>;
  abstract cleanup(): Promise<void>;

  abstract pickFiles(options?: FilePickerOptions): Promise<FileMetadata[]>;
}

export interface FileSystemAdapterFactory {
  create(): FileSystemAdapter;
  name: string;
  description: string;
  supported: boolean;
}
