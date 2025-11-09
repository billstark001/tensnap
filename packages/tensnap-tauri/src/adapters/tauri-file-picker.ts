import {
  type FileMetadata,
  FileSystemPicker,
  type FilePickerOptions
} from 'tensnap-web/types/file';
import { invoke } from '@tauri-apps/api/core';

/**
 * TauriFilePicker: 使用 Tauri 原生文件对话框的文件选择器
 * 
 * 这个类通过 Tauri 的 allowlist 中启用的 dialog API 提供原生的文件选择体验,
 * 支持单选、多选和保存文件对话框。
 * 
 * 注意：需要在 tauri.conf.json 中启用 dialog.open 和 dialog.save 权限
 */
export class TauriFilePicker extends FileSystemPicker {
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) {
      console.warn('TauriFilePicker is already initialized');
      return;
    }
    this.initialized = true;
  }

  async cleanup(): Promise<void> {
    this.initialized = false;
  }

  async pickFiles(options?: FilePickerOptions): Promise<FileMetadata[]> {
    if (!this.initialized) {
      throw new Error("File picker not initialized. Call initialize() first.");
    }

    const {
      title,
      multiSelect = false,
      mode = 'open'
    } = options || {};

    try {
      if (mode === 'save') {
        // 保存文件模式 - 使用 Tauri 的 dialog save API
        // 注意：在 Tauri v2 中，这需要使用全局 API 或通过命令调用
        const filePath = await this.invokeSaveDialog(title || 'Save File');

        if (!filePath) {
          return [];
        }

        // 对于保存模式，返回一个带有路径的文件元数据
        // 注意：保存模式下文件可能还不存在，所以我们创建一个基本的元数据
        return [{
          name: this.extractFileName(filePath),
          path: filePath,
          parentPath: this.extractParentPath(filePath),
          size: 0,
          mimeType: this.guessMimeType(filePath),
          createdAt: new Date(),
          modifiedAt: new Date()
        }];
      } else {
        // 打开文件模式 - 使用 Tauri 的 dialog open API
        const paths = await this.invokeOpenDialog(
          title || 'Select File(s)',
          multiSelect
        );

        if (!paths || paths.length === 0) {
          return [];
        }

        // 获取每个文件的完整元数据
        const metadataPromises = paths.map(path => this.getFileMetadata(path));
        const metadataResults = await Promise.allSettled(metadataPromises);

        // 过滤出成功的结果
        return metadataResults
          .filter((result): result is PromiseFulfilledResult<FileMetadata> => 
            result.status === 'fulfilled'
          )
          .map(result => result.value);
      }
    } catch (error) {
      console.error('Failed to pick files:', error);
      return [];
    }
  }

  /**
   * 调用 Tauri 的打开文件对话框
   * 使用 window.__TAURI__ 全局 API (需要在 tauri.conf.json 中启用)
   */
  private async invokeOpenDialog(title: string, multiple: boolean): Promise<string[]> {
    // 尝试使用全局 Tauri API
    const tauri = (window as any).__TAURI__;
    if (tauri && tauri.dialog && tauri.dialog.open) {
      const result = await tauri.dialog.open({
        title,
        multiple,
        directory: false
      });
      
      if (!result) return [];
      return Array.isArray(result) ? result : [result];
    }

    // 如果全局 API 不可用，提示用户
    throw new Error('Tauri dialog API not available. Please ensure withGlobalTauri is enabled in tauri.conf.json');
  }

  /**
   * 调用 Tauri 的保存文件对话框
   */
  private async invokeSaveDialog(title: string): Promise<string | null> {
    const tauri = (window as any).__TAURI__;
    if (tauri && tauri.dialog && tauri.dialog.save) {
      return await tauri.dialog.save({ title });
    }

    throw new Error('Tauri dialog API not available. Please ensure withGlobalTauri is enabled in tauri.conf.json');
  }

  /**
   * 从 Tauri 后端获取文件元数据
   */
  private async getFileMetadata(path: string): Promise<FileMetadata> {
    try {
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

      const tauriMetadata: TauriFileMetadata = await invoke('get_file_metadata_handler', { path });

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
    } catch (error) {
      console.error(`Failed to get metadata for ${path}:`, error);
      
      // 如果无法获取元数据，返回基本信息
      return {
        name: this.extractFileName(path),
        path: path,
        parentPath: this.extractParentPath(path),
        size: 0,
        mimeType: this.guessMimeType(path),
        createdAt: new Date(),
        modifiedAt: new Date()
      };
    }
  }

  /**
   * 从路径中提取文件名
   */
  private extractFileName(path: string): string {
    const parts = path.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || 'unknown';
  }

  /**
   * 从路径中提取父目录路径
   */
  private extractParentPath(path: string): string {
    const normalizedPath = path.replace(/\\/g, '/');
    const lastSlashIndex = normalizedPath.lastIndexOf('/');
    return lastSlashIndex > 0 ? normalizedPath.substring(0, lastSlashIndex) : '/';
  }

  /**
   * 根据文件扩展名猜测 MIME 类型
   */
  private guessMimeType(path: string): string {
    const extension = path.split('.').pop()?.toLowerCase();
    
    const mimeTypes: Record<string, string> = {
      'txt': 'text/plain',
      'json': 'application/json',
      'js': 'application/javascript',
      'ts': 'application/typescript',
      'tsx': 'application/typescript',
      'jsx': 'application/javascript',
      'html': 'text/html',
      'css': 'text/css',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'svg': 'image/svg+xml',
      'pdf': 'application/pdf',
      'zip': 'application/zip',
      'npy': 'application/octet-stream',
      'md': 'text/markdown',
      'xml': 'application/xml',
      'csv': 'text/csv'
    };

    return mimeTypes[extension || ''] || 'application/octet-stream';
  }
}
