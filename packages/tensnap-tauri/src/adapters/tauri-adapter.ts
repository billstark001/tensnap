import { FileSystemAdapter } from 'tensnap-web-utils/adapters';
import type {
  FileMetadata,
  FileContent,
  DirectoryMetadata,
  DirectoryEntry,
  FileSystemStats
} from 'tensnap-web/types/file';
import { invoke } from '@tauri-apps/api/tauri';

interface TauriFileMetadata {
  name: string;
  path: string;
  parent_path: string;
  size: number;
  mime_type: string;
  created_at: number;
  modified_at: number;
  tags?: string[];
  description?: string;
}

interface TauriDirectoryMetadata {
  name: string;
  path: string;
  parent_path: string;
  created_at: number;
  modified_at: number;
  description?: string;
  tags?: string[];
}

interface TauriDirectoryEntry {
  type: 'file' | 'directory';
  name: string;
  path: string;
}

export class TauriFileSystemAdapter extends FileSystemAdapter {
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
  }

  async cleanup(): Promise<void> {
    this.initialized = false;
  }

  // File operations
  async writeFile(
    path: string,
    content: ArrayBuffer | string,
    _metadata?: Partial<Omit<FileMetadata, 'path' | 'parentPath' | 'createdAt' | 'modifiedAt'>>
  ): Promise<FileContent> {
    const buffer = content instanceof ArrayBuffer
      ? Array.from(new Uint8Array(content))
      : Array.from(new TextEncoder().encode(content));

    const tauriMetadata: TauriFileMetadata = await invoke('create_file_handler', {
      path,
      content: buffer
    });

    const fileMetadata = this.convertTauriFileMetadata(tauriMetadata);
    const contentBuffer = content instanceof ArrayBuffer ? content : new TextEncoder().encode(content).buffer;

    return {
      metadata: fileMetadata,
      content: contentBuffer,
      checksum: await this.calculateChecksum(contentBuffer)
    };
  }

  async readFile(path: string): Promise<FileContent | null> {
    try {
      const [content, metadata]: [number[], TauriFileMetadata] = await Promise.all([
        invoke('read_file_handler', { path }) as any,
        invoke('get_file_metadata_handler', { path }) as any
      ]);

      const contentBuffer = new Uint8Array(content).buffer;

      return {
        metadata: this.convertTauriFileMetadata(metadata),
        content: contentBuffer,
        checksum: await this.calculateChecksum(contentBuffer)
      };
    } catch (error) {
      console.error('Failed to read file:', error);
      return null;
    }
  }

  async deleteFile(path: string): Promise<void> {
    await invoke('delete_file_handler', { path });
  }

  async fileExists(path: string): Promise<boolean> {
    return await invoke('file_exists_handler', { path });
  }

  // Directory operations
  async createDirectory(path: string, allowExist?: boolean): Promise<DirectoryMetadata> {
    const tauriMetadata: TauriDirectoryMetadata = await invoke('create_directory_handler', {
      path,
      allowExist
    });

    return this.convertTauriDirectoryMetadata(tauriMetadata);
  }

  async deleteDirectory(path: string, recursive?: boolean): Promise<void> {
    await invoke('delete_directory_handler', { path, recursive });
  }

  async list(path: string): Promise<DirectoryEntry[]> {
    const tauriEntries: TauriDirectoryEntry[] = await invoke('read_directory_handler', { path });

    // Convert entries to full DirectoryEntry with metadata
    const entries: DirectoryEntry[] = [];
    
    for (const entry of tauriEntries) {
      if (entry.type === 'file') {
        try {
          const fileMetadata = await this.getFileMetadata(entry.path);
          entries.push({ type: 'file', ...fileMetadata });
        } catch (error) {
          console.warn(`Failed to get metadata for file: ${entry.path}`, error);
        }
      } else {
        // For directories, create basic metadata since Tauri doesn't provide full metadata
        const dirMetadata: DirectoryMetadata = {
          name: entry.name,
          path: entry.path,
          parentPath: path,
          createdAt: new Date(),
          modifiedAt: new Date()
        };
        entries.push({ type: 'directory', ...dirMetadata });
      }
    }

    return entries;
  }

  private async getFileMetadata(path: string): Promise<FileMetadata> {
    const tauriMetadata: TauriFileMetadata = await invoke('get_file_metadata_handler', { path });
    return this.convertTauriFileMetadata(tauriMetadata);
  }

  async directoryExists(path: string): Promise<boolean> {
    return await invoke('directory_exists_handler', { path });
  }

  // File system operations
  async getStats(): Promise<FileSystemStats> {
    // This is a simplified implementation
    // In a real implementation, you might want to call system APIs
    return {
      totalFiles: 0,
      totalDirectories: 0,
      totalSize: 0,
      lastBackup: undefined,
      storageQuota: undefined,
      storageUsed: undefined
    };
  }

  // Helper methods
  private convertTauriFileMetadata(tauriMetadata: TauriFileMetadata): FileMetadata {
    return {
      name: tauriMetadata.name,
      path: tauriMetadata.path,
      parentPath: tauriMetadata.parent_path,
      size: tauriMetadata.size,
      mimeType: tauriMetadata.mime_type,
      createdAt: new Date(tauriMetadata.created_at * 1000),
      modifiedAt: new Date(tauriMetadata.modified_at * 1000),
      tags: tauriMetadata.tags,
      description: tauriMetadata.description
    };
  }

  private convertTauriDirectoryMetadata(tauriMetadata: TauriDirectoryMetadata): DirectoryMetadata {
    return {
      name: tauriMetadata.name,
      path: tauriMetadata.path,
      parentPath: tauriMetadata.parent_path,
      createdAt: new Date(tauriMetadata.created_at * 1000),
      modifiedAt: new Date(tauriMetadata.modified_at * 1000),
      description: tauriMetadata.description,
      tags: tauriMetadata.tags
    };
  }

  private async calculateChecksum(content: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', content);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}
