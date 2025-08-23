export interface FileMetadata {
  name: string;
  path: string;
  parentPath: string;
  size: number;
  mimeType: string;
  createdAt: Date;
  modifiedAt: Date;
  tags?: string[];
  description?: string;
}

export interface FileContent {
  metadata: FileMetadata;
  content: ArrayBuffer | string;
  checksum: string;
}

export interface DirectoryMetadata {
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
  name: string;
  path: string;
}

export interface FileSystemStats {
  totalFiles: number;
  totalDirectories: number;
  totalSize: number;
  lastBackup?: Date;
  storageQuota?: number;
  storageUsed?: number;
}

export interface FileSystemError extends Error {
  code: 'NOT_FOUND' | 'PERMISSION_DENIED' | 'QUOTA_EXCEEDED' | 'INVALID_OPERATION' | 'STORAGE_ERROR' | 'PATH_EXISTS';
  path?: string;
  operation?: string;
}
