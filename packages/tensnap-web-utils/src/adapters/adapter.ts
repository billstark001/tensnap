import type { 
  FileMetadata, 
  FileContent, 
  DirectoryMetadata,
  DirectoryEntry,
  FileSystemStats
} from 'tensnap-web/types/file';

/**
 * Simplified FileSystem Adapter Interface
 * Only includes essential operations: read, write, delete, list, and stat
 */
export abstract class FileSystemAdapter {
  abstract initialize(): Promise<void>;
  abstract cleanup(): Promise<void>;

  // Essential file operations
  abstract writeFile(path: string, content: ArrayBuffer | string, metadata?: Partial<Omit<FileMetadata, 'path' | 'parentPath' | 'createdAt' | 'modifiedAt'>>): Promise<FileContent>;
  abstract readFile(path: string): Promise<FileContent | null>;
  abstract deleteFile(path: string): Promise<void>;

  // Essential directory operations
  abstract createDirectory(path: string, allowExist?: boolean): Promise<DirectoryMetadata>;
  abstract deleteDirectory(path: string, recursive?: boolean): Promise<void>;
  
  // Unified list operation - lists all entries (files and directories) in a path
  abstract list(path: string): Promise<DirectoryEntry[]>;

  // Essential stat operations
  abstract getStats(): Promise<FileSystemStats>;
  abstract fileExists(path: string): Promise<boolean>;
  abstract directoryExists(path: string): Promise<boolean>;
}

export interface FileSystemAdapterFactory {
  create(): FileSystemAdapter;
  name: string;
  description: string;
  supported: boolean;
}
