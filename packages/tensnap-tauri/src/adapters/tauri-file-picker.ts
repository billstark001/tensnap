import {
  type FileMetadata,
  FileSystemPicker,
  type FilePickerOptions,
} from '@tensnap/web-common/types/file';
import { open, save } from '@tauri-apps/plugin-dialog';
import { stat } from '@tauri-apps/plugin-fs';

/** Native picker using Tauri's dialog plugin and dynamically-scoped paths. */
export class TauriFilePicker extends FileSystemPicker {
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async cleanup(): Promise<void> {
    this.initialized = false;
  }

  async pickFiles(options?: FilePickerOptions): Promise<FileMetadata[]> {
    if (!this.initialized) {
      throw new Error('File picker not initialized. Call initialize() first.');
    }

    const { title, multiSelect = false, mode = 'open' } = options ?? {};
    try {
      if (mode === 'save') {
        const path = await save({ title: title || 'Save File' });
        return path ? [this.newFileMetadata(path)] : [];
      }

      const selection = await open({ title: title || 'Select File(s)', multiple: multiSelect, directory: false });
      const paths = selection == null ? [] : (Array.isArray(selection) ? selection : [selection]);
      const results = await Promise.allSettled(paths.map((path) => this.getFileMetadata(path)));
      return results
        .filter((result): result is PromiseFulfilledResult<FileMetadata> => result.status === 'fulfilled')
        .map((result) => result.value);
    } catch (error) {
      console.error('Failed to pick files:', error);
      return [];
    }
  }

  private async getFileMetadata(path: string): Promise<FileMetadata> {
    const info = await stat(path);
    return {
      ...this.newFileMetadata(path),
      size: info.size,
      createdAt: info.birthtime ?? info.mtime ?? new Date(),
      modifiedAt: info.mtime ?? info.birthtime ?? new Date(),
    };
  }

  private newFileMetadata(path: string): FileMetadata {
    return {
      name: this.fileName(path),
      path,
      parentPath: this.parentPath(path),
      size: 0,
      mimeType: this.guessMimeType(path),
      createdAt: new Date(),
      modifiedAt: new Date(),
    };
  }

  private fileName(path: string): string {
    const parts = path.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || 'unknown';
  }

  private parentPath(path: string): string {
    const normalized = path.replace(/\\/g, '/');
    const separator = normalized.lastIndexOf('/');
    return separator <= 0 ? '/' : normalized.slice(0, separator);
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
}
