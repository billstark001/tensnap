import {
  type DirectoryEntry,
  type DirectoryMetadata,
  type FileContent,
  type FileMetadata,
  FileSystemAdapter,
  type FileSystemStats,
} from '@tensnap/web-common/types/file';
import {
  exists,
  mkdir,
  readDir,
  readFile,
  remove,
  stat,
  writeFile,
} from '@tauri-apps/plugin-fs';

/**
 * Native filesystem adapter backed by Tauri's scoped fs plugin.
 *
 * The dialog plugin grants the selected paths to the fs scope for the current
 * application session. No renderer-controlled path is sent through a custom
 * Rust command.
 */
export class TauriFileSystemAdapter extends FileSystemAdapter {
  async initialize(): Promise<void> {
    // The scoped fs plugin has no per-adapter initialization.
  }

  async cleanup(): Promise<void> {
    // The scoped fs plugin has no per-adapter cleanup.
  }

  async writeFile(
    path: string,
    content: ArrayBuffer | string,
    _metadata?: Partial<Omit<FileMetadata, 'path' | 'parentPath' | 'createdAt' | 'modifiedAt'>>,
  ): Promise<FileContent> {
    void _metadata;
    const bytes = content instanceof ArrayBuffer ? new Uint8Array(content) : new TextEncoder().encode(content);
    await writeFile(path, bytes);
    const contentBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    return {
      metadata: await this.getFileMetadata(path),
      content: contentBuffer,
      checksum: await this.calculateChecksum(contentBuffer),
    };
  }

  async readFile(path: string): Promise<FileContent | null> {
    try {
      const [bytes, metadata] = await Promise.all([readFile(path), this.getFileMetadata(path)]);
      const content = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      return {
        metadata,
        content,
        checksum: await this.calculateChecksum(content),
      };
    } catch (error) {
      console.error('Failed to read file:', error);
      return null;
    }
  }

  async deleteFile(path: string): Promise<void> {
    await remove(path);
  }

  async fileExists(path: string): Promise<boolean> {
    if (!await exists(path)) return false;
    return (await stat(path)).isFile;
  }

  async createDirectory(path: string, allowExist?: boolean): Promise<DirectoryMetadata> {
    await mkdir(path, { recursive: allowExist === true });
    return this.getDirectoryMetadata(path);
  }

  async deleteDirectory(path: string, recursive?: boolean): Promise<void> {
    await remove(path, { recursive });
  }

  async list(path: string): Promise<DirectoryEntry[]> {
    const entries = await readDir(path);
    return Promise.all(entries.flatMap(async (entry): Promise<DirectoryEntry[]> => {
      const entryPath = this.joinPath(path, entry.name);
      if (entry.isFile) return [{ type: 'file', ...await this.getFileMetadata(entryPath) }];
      if (entry.isDirectory) return [{ type: 'directory', ...await this.getDirectoryMetadata(entryPath) }];
      return [];
    })).then((groups) => groups.flat());
  }

  async directoryExists(path: string): Promise<boolean> {
    if (!await exists(path)) return false;
    return (await stat(path)).isDirectory;
  }

  async getStats(): Promise<FileSystemStats> {
    return {
      totalFiles: 0,
      totalDirectories: 0,
      totalSize: 0,
      lastBackup: undefined,
      storageQuota: undefined,
      storageUsed: undefined,
    };
  }

  private async getFileMetadata(path: string): Promise<FileMetadata> {
    const info = await stat(path);
    return {
      name: this.fileName(path),
      path,
      parentPath: this.parentPath(path),
      size: info.size,
      mimeType: this.guessMimeType(path),
      createdAt: info.birthtime ?? info.mtime ?? new Date(),
      modifiedAt: info.mtime ?? info.birthtime ?? new Date(),
    };
  }

  private async getDirectoryMetadata(path: string): Promise<DirectoryMetadata> {
    const info = await stat(path);
    return {
      name: this.fileName(path),
      path,
      parentPath: this.parentPath(path),
      createdAt: info.birthtime ?? info.mtime ?? new Date(),
      modifiedAt: info.mtime ?? info.birthtime ?? new Date(),
    };
  }

  private fileName(path: string): string {
    const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
    const parts = normalized.split('/');
    return parts[parts.length - 1] || 'unknown';
  }

  private parentPath(path: string): string {
    const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
    const separator = normalized.lastIndexOf('/');
    if (separator < 0) return '.';
    return separator === 0 ? '/' : normalized.slice(0, separator);
  }

  private joinPath(parent: string, child: string): string {
    if (parent.endsWith('/') || parent.endsWith('\\')) return `${parent}${child}`;
    return `${parent}${parent.includes('\\') ? '\\' : '/'}${child}`;
  }

  private guessMimeType(path: string): string {
    const parts = path.split('.');
    const extension = parts[parts.length - 1]?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      txt: 'text/plain', json: 'application/json', js: 'application/javascript',
      ts: 'application/typescript', tsx: 'application/typescript', jsx: 'application/javascript',
      html: 'text/html', css: 'text/css', png: 'image/png', jpg: 'image/jpeg',
      jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', pdf: 'application/pdf',
      zip: 'application/zip', npy: 'application/octet-stream', md: 'text/markdown',
      xml: 'application/xml', csv: 'text/csv',
    };
    return mimeTypes[extension ?? ''] ?? 'application/octet-stream';
  }

  private async calculateChecksum(content: ArrayBuffer): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', content);
    return Array.from(new Uint8Array(hashBuffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
}
