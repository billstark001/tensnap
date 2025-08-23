import { FileSystemAdapter } from 'tensnap-web/store/file-system/adapter';
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

  async getFile(path: string): Promise<FileContent | null> {
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
      console.error('Failed to get file:', error);
      return null;
    }
  }

  async deleteFile(path: string): Promise<void> {
    await invoke('delete_file_handler', { path });
  }

  async moveFile(oldPath: string, newPath: string): Promise<FileContent> {
    const tauriMetadata: TauriFileMetadata = await invoke('move_file_handler', {
      oldPath,
      newPath
    });

    // Get the content of the moved file
    const content: number[] = await invoke('read_file_handler', { path: newPath });
    const contentBuffer = new Uint8Array(content).buffer;

    return {
      metadata: this.convertTauriFileMetadata(tauriMetadata),
      content: contentBuffer,
      checksum: await this.calculateChecksum(contentBuffer)
    };
  }

  async copyFile(sourcePath: string, targetPath: string): Promise<FileContent> {
    const tauriMetadata: TauriFileMetadata = await invoke('copy_file_handler', {
      sourcePath,
      targetPath
    });

    // Get the content of the copied file
    const content: number[] = await invoke('read_file_handler', { path: targetPath });
    const contentBuffer = new Uint8Array(content).buffer;

    return {
      metadata: this.convertTauriFileMetadata(tauriMetadata),
      content: contentBuffer,
      checksum: await this.calculateChecksum(contentBuffer)
    };
  }

  async listFiles(directoryPath?: string): Promise<FileMetadata[]> {
    const tauriFiles: TauriFileMetadata[] = await invoke('list_files_handler', {
      directoryPath
    });

    return tauriFiles.map(f => this.convertTauriFileMetadata(f));
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

  async getDirectory(path: string): Promise<DirectoryMetadata | null> {
    try {
      const exists = await this.directoryExists(path);
      if (!exists) return null;

      // Since we don't have a direct get_directory_metadata command,
      // we'll create one by reading the directory and getting its info
      // const entries = await this.listDirectoryContents(path);

      return {
        name: path.split('/').pop() || path,
        path,
        parentPath: path.includes('/') ? path.substring(0, path.lastIndexOf('/')) : '.',
        createdAt: new Date(),
        modifiedAt: new Date()
      };
    } catch (error) {
      console.error('Failed to get directory:', error);
      return null;
    }
  }

  async deleteDirectory(path: string, recursive?: boolean): Promise<void> {
    await invoke('delete_directory_handler', { path, recursive });
  }

  async moveDirectory(oldPath: string, newPath: string): Promise<DirectoryMetadata> {
    // Tauri doesn't have a direct move directory command, so we'll implement it
    // by creating the new directory and moving all contents
    await this.createDirectory(newPath, true);

    const entries = await this.listDirectoryContents(oldPath);

    for (const entry of entries) {
      const oldEntryPath = entry.path;
      const newEntryPath = entry.path.replace(oldPath, newPath);

      if (entry.type === 'file') {
        await this.moveFile(oldEntryPath, newEntryPath);
      } else {
        await this.moveDirectory(oldEntryPath, newEntryPath);
      }
    }

    await this.deleteDirectory(oldPath, true);

    return (await this.getDirectory(newPath))!;
  }

  async copyDirectory(sourcePath: string, targetPath: string): Promise<DirectoryMetadata> {
    await this.createDirectory(targetPath, true);

    const entries = await this.listDirectoryContents(sourcePath);

    for (const entry of entries) {
      const sourceEntryPath = entry.path;
      const targetEntryPath = entry.path.replace(sourcePath, targetPath);

      if (entry.type === 'file') {
        await this.copyFile(sourceEntryPath, targetEntryPath);
      } else {
        await this.copyDirectory(sourceEntryPath, targetEntryPath);
      }
    }

    return (await this.getDirectory(targetPath))!;
  }

  async listDirectories(parentPath?: string): Promise<DirectoryMetadata[]> {
    const entries = await this.listDirectoryContents(parentPath || '.');
    const directories = entries.filter(entry => entry.type === 'directory');

    const results: DirectoryMetadata[] = [];
    for (const dir of directories) {
      const metadata = await this.getDirectory(dir.path);
      if (metadata) {
        results.push(metadata);
      }
    }

    return results;
  }

  async listDirectoryContents(path: string): Promise<DirectoryEntry[]> {
    const tauriEntries: TauriDirectoryEntry[] = await invoke('read_directory_handler', { path });

    return tauriEntries.map(entry => ({
      type: entry.type,
      name: entry.name,
      path: entry.path
    }));
  }

  async directoryExists(path: string): Promise<boolean> {
    return await invoke('directory_exists_handler', { path });
  }

  async isDirectoryEmpty(path: string): Promise<boolean> {
    const entries = await this.listDirectoryContents(path);
    return entries.length === 0;
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

  async search(
    query: string,
    searchPath?: string,
    _includeContent?: boolean
  ): Promise<(FileMetadata | DirectoryMetadata)[]> {
    // This is a simplified implementation
    // In a real implementation, you'd use more sophisticated search
    const results: (FileMetadata | DirectoryMetadata)[] = [];

    const searchIn = searchPath || '.';
    const entries = await this.listDirectoryContents(searchIn);

    for (const entry of entries) {
      if (entry.name.toLowerCase().includes(query.toLowerCase())) {
        if (entry.type === 'file') {
          const file = await this.getFile(entry.path);
          if (file) {
            results.push(file.metadata);
          }
        } else {
          const dir = await this.getDirectory(entry.path);
          if (dir) {
            results.push(dir);
          }
        }
      }
    }

    return results;
  }

  async exportDirectory(_path: string, _format?: 'zip' | 'tar' | 'json'): Promise<Blob> {
    // This would require implementing archive creation in Rust
    // For now, return an empty blob
    throw new Error('Export functionality not implemented yet');
  }

  async importDirectory(_data: Blob, _targetPath: string): Promise<DirectoryMetadata> {
    // This would require implementing archive extraction in Rust
    // For now, throw an error
    throw new Error('Import functionality not implemented yet');
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
