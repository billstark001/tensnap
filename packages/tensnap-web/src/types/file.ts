export interface FileMetadata {
  id: string;
  name: string;
  path: string;
  parentPath: string;
  size: number;
  mimeType: string;
  createdAt: Date;
  modifiedAt: Date;
  version: number;
  tags?: string[];
  description?: string;
}

export interface FileContent {
  id: string;
  metadata: FileMetadata;
  content: ArrayBuffer | string;
  checksum: string;
}

export interface DirectoryMetadata {
  id: string;
  name: string;
  path: string;
  parentPath: string;
  createdAt: Date;
  modifiedAt: Date;
  description?: string;
  tags?: string[];
}

export interface DirectoryEntry {
  type: 'file' | 'directory';
  metadata: FileMetadata | DirectoryMetadata;
}

export interface FileSystemStats {
  totalFiles: number;
  totalDirectories: number;
  totalSize: number;
  lastBackup?: Date;
  storageQuota?: number;
  storageUsed?: number;
}

export interface FileOperation {
  type: 'create' | 'update' | 'delete' | 'rename' | 'move';
  fileId: string;
  timestamp: Date;
  metadata?: Partial<FileMetadata>;
  oldPath?: string;
  newPath?: string;
}

export interface DirectoryOperation {
  type: 'create' | 'delete' | 'rename' | 'move';
  directoryId: string;
  timestamp: Date;
  metadata?: Partial<DirectoryMetadata>;
  oldPath?: string;
  newPath?: string;
}

export interface FileSystemError extends Error {
  code: 'NOT_FOUND' | 'PERMISSION_DENIED' | 'QUOTA_EXCEEDED' | 'INVALID_OPERATION' | 'STORAGE_ERROR' | 'PATH_EXISTS';
  fileId?: string;
  path?: string;
  operation?: string;
}
