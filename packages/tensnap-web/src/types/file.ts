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

export interface DirectoryMetadata extends BaseMetadata {
}

export type DirectoryEntry = ({ type: 'file' } & FileMetadata) | ({ type: 'directory' } & DirectoryMetadata);

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
