import { 
  FileMetadata, 
  FileContent, 
  DirectoryMetadata,
  DirectoryEntry,
  FileSystemStats
} from '@/types/file';

export abstract class FileSystemAdapter {
  abstract initialize(): Promise<void>;
  abstract cleanup(): Promise<void>;

  // File operations
  abstract writeFile(path: string, content: ArrayBuffer | string, metadata?: Partial<Omit<FileMetadata, 'path' | 'parentPath' | 'createdAt' | 'modifiedAt'>>): Promise<FileContent>;
  abstract getFile(path: string): Promise<FileContent | null>;
  abstract deleteFile(path: string): Promise<void>;
  abstract moveFile(oldPath: string, newPath: string): Promise<FileContent>;
  abstract copyFile(sourcePath: string, targetPath: string): Promise<FileContent>;
  abstract listFiles(directoryPath?: string): Promise<FileMetadata[]>;
  abstract fileExists(path: string): Promise<boolean>;

  // Directory operations
  abstract createDirectory(path: string, allowExist?: boolean): Promise<DirectoryMetadata>;
  abstract getDirectory(path: string): Promise<DirectoryMetadata | null>;
  abstract deleteDirectory(path: string, recursive?: boolean): Promise<void>;
  abstract moveDirectory(oldPath: string, newPath: string): Promise<DirectoryMetadata>;
  abstract copyDirectory(sourcePath: string, targetPath: string): Promise<DirectoryMetadata>;
  abstract listDirectories(parentPath?: string): Promise<DirectoryMetadata[]>;
  abstract listDirectoryContents(path: string): Promise<DirectoryEntry[]>;
  abstract directoryExists(path: string): Promise<boolean>;
  abstract isDirectoryEmpty(path: string): Promise<boolean>;

  // File system operations
  abstract getStats(): Promise<FileSystemStats>;
  abstract search(query: string, searchPath?: string, includeContent?: boolean): Promise<(FileMetadata | DirectoryMetadata)[]>;
  abstract exportDirectory(path: string, format?: 'zip' | 'tar' | 'json'): Promise<Blob>;
  abstract importDirectory(data: Blob, targetPath: string): Promise<DirectoryMetadata>;
}

export interface FileSystemAdapterFactory {
  create(): FileSystemAdapter;
  name: string;
  description: string;
  supported: boolean;
}
