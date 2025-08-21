import { 
  FileMetadata, 
  FileContent, 
  DirectoryMetadata,
  DirectoryEntry,
  FileSystemStats, 
  FileOperation,
  DirectoryOperation
} from '../../types/file';

export abstract class FileSystemAdapter {
  abstract initialize(): Promise<void>;
  abstract cleanup(): Promise<void>;

  // File operations
  abstract createFile(metadata: Omit<FileMetadata, 'id' | 'createdAt' | 'modifiedAt' | 'version'>, content: ArrayBuffer | string): Promise<FileContent>;
  abstract getFile(id: string): Promise<FileContent | null>;
  abstract getFileByPath(path: string): Promise<FileContent | null>;
  abstract updateFile(id: string, content: ArrayBuffer | string, metadata?: Partial<FileMetadata>): Promise<FileContent>;
  abstract deleteFile(id: string): Promise<void>;
  abstract moveFile(id: string, newPath: string): Promise<FileContent>;
  abstract copyFile(id: string, newPath: string): Promise<FileContent>;
  abstract listFiles(directoryPath?: string): Promise<FileMetadata[]>;
  abstract fileExists(path: string): Promise<boolean>;

  // Directory operations
  abstract createDirectory(metadata: Omit<DirectoryMetadata, 'id' | 'createdAt' | 'modifiedAt'>): Promise<DirectoryMetadata>;
  abstract getDirectory(id: string): Promise<DirectoryMetadata | null>;
  abstract getDirectoryByPath(path: string): Promise<DirectoryMetadata | null>;
  abstract updateDirectory(id: string, metadata: Partial<DirectoryMetadata>): Promise<DirectoryMetadata>;
  abstract deleteDirectory(id: string, recursive?: boolean): Promise<void>;
  abstract moveDirectory(id: string, newPath: string): Promise<DirectoryMetadata>;
  abstract copyDirectory(id: string, newPath: string): Promise<DirectoryMetadata>;
  abstract listDirectories(parentPath?: string): Promise<DirectoryMetadata[]>;
  abstract listDirectoryContents(path: string): Promise<DirectoryEntry[]>;
  abstract directoryExists(path: string): Promise<boolean>;
  abstract isDirectoryEmpty(path: string): Promise<boolean>;

  // Path operations
  abstract resolvePath(path: string): string;
  abstract getParentPath(path: string): string;
  abstract joinPaths(...paths: string[]): string;
  abstract getPathDepth(path: string): number;
  abstract getPathComponents(path: string): string[];

  // File system operations
  abstract getStats(): Promise<FileSystemStats>;
  abstract getFileHistory(fileId: string): Promise<FileOperation[]>;
  abstract getDirectoryHistory(directoryId: string): Promise<DirectoryOperation[]>;
  abstract search(query: string, searchPath?: string, includeContent?: boolean): Promise<(FileMetadata | DirectoryMetadata)[]>;
  abstract exportDirectory(path: string, format?: 'zip' | 'tar' | 'json'): Promise<Blob>;
  abstract importDirectory(data: Blob, targetPath: string): Promise<DirectoryMetadata>;

  // Utilities
  protected generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  protected calculateChecksum(content: ArrayBuffer | string): string {
    // Simple checksum implementation
    const str = typeof content === 'string' ? content : new TextDecoder().decode(content);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }

  protected normalizePath(path: string): string {
    // Normalize path separators and remove duplicates
    return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  }

  protected validatePath(path: string): boolean {
    // Basic path validation
    if (!path || typeof path !== 'string') return false;
    if (path.includes('..')) return false; // Prevent directory traversal
    if (path.includes('\0')) return false; // Null bytes not allowed
    return true;
  }
}

export interface FileSystemAdapterFactory {
  create(): FileSystemAdapter;
  name: string;
  description: string;
  supported: boolean;
}
