/**
 * 文件选择器抽象接口
 * 支持多种环境下的文件选择（Web、Electron等）
 */

export interface FilePickerOptions {
  /** 文件类型过滤器 */
  filters?: FileFilter[];
  /** 是否允许多选 */
  multiple?: boolean;
  /** 选择模式：文件、目录或两者 */
  mode?: 'files' | 'directories' | 'both';
  /** 默认路径 */
  defaultPath?: string;
  /** 对话框标题 */
  title?: string;
}

export interface FileFilter {
  /** 过滤器名称 */
  name: string;
  /** 文件扩展名数组 */
  extensions: string[];
}

export interface SelectedFile {
  /** 文件名 */
  name: string;
  /** 文件路径（在某些环境中可能不可用） */
  path?: string;
  /** 文件大小 */
  size: number;
  /** MIME 类型 */
  type: string;
  /** 最后修改时间 */
  lastModified: Date;
  /** 文件内容（仅Web环境） */
  file?: File;
}

export interface SelectedDirectory {
  /** 目录名 */
  name: string;
  /** 目录路径 */
  path?: string;
}

export type FilePickerResult = {
  files: SelectedFile[];
  directories: SelectedDirectory[];
  cancelled: boolean;
};

/**
 * 文件选择器抽象基类
 */
export abstract class FilePicker {
  abstract pickFiles(options?: FilePickerOptions): Promise<FilePickerResult>;
  abstract isSupported(): boolean;
  abstract getName(): string;
}

/**
 * Web 环境文件选择器（使用 HTML input[type="file"]）
 */
export class WebFilePicker extends FilePicker {
  async pickFiles(options: FilePickerOptions = {}): Promise<FilePickerResult> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = options.multiple || false;
      
      // 设置文件类型过滤器
      if (options.filters && options.filters.length > 0) {
        const extensions = options.filters
          .flatMap(filter => filter.extensions)
          .map(ext => `.${ext}`)
          .join(',');
        input.accept = extensions;
      }

      // 如果支持目录选择
      if (options.mode === 'directories') {
        (input as any).webkitdirectory = true;
      }

      input.onchange = async (event) => {
        const files = (event.target as HTMLInputElement).files;
        
        if (!files || files.length === 0) {
          resolve({ files: [], directories: [], cancelled: true });
          return;
        }

        const selectedFiles: SelectedFile[] = [];
        const selectedDirectoryNames = new Set<string>();

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          
          selectedFiles.push({
            name: file.name,
            path: (file as any).webkitRelativePath || file.name,
            size: file.size,
            type: file.type,
            lastModified: new Date(file.lastModified),
            file: file
          });

          // 如果是目录选择模式，提取目录信息
          if (options.mode === 'directories' && (file as any).webkitRelativePath) {
            const relativePath = (file as any).webkitRelativePath as string;
            const pathParts = relativePath.split('/');
            if (pathParts.length > 1) {
              selectedDirectoryNames.add(pathParts[0]);
            }
          }
        }

        const directories: SelectedDirectory[] = Array.from(selectedDirectoryNames).map((name: string) => ({
          name,
          path: name
        }));

        resolve({
          files: selectedFiles,
          directories,
          cancelled: false
        });

        // 清理
        document.body.removeChild(input);
      };

      input.oncancel = () => {
        resolve({ files: [], directories: [], cancelled: true });
        document.body.removeChild(input);
      };

      // 隐藏 input 并触发点击
      input.style.display = 'none';
      document.body.appendChild(input);
      input.click();
    });
  }

  isSupported(): boolean {
    return typeof window !== 'undefined' && 'File' in window;
  }

  getName(): string {
    return 'Web File Picker';
  }
}

/**
 * React 组件文件选择器（内部浏览器）
 */
export class ReactFilePicker extends FilePicker {
  constructor(
    private onOpenBrowser: (options: FilePickerOptions) => Promise<FilePickerResult>
  ) {
    super();
  }

  async pickFiles(options: FilePickerOptions = {}): Promise<FilePickerResult> {
    return await this.onOpenBrowser(options);
  }

  isSupported(): boolean {
    return true;
  }

  getName(): string {
    return 'Internal File Browser';
  }
}

/**
 * Electron 环境文件选择器（使用系统对话框）
 */
export class ElectronFilePicker extends FilePicker {
  async pickFiles(options: FilePickerOptions = {}): Promise<FilePickerResult> {
    // 这里需要通过 IPC 与主进程通信
    // 实际实现取决于 Electron 的设置
    if (!(window as any).electronAPI) {
      throw new Error('Electron API not available');
    }

    try {
      const result = await (window as any).electronAPI.showOpenDialog({
        title: options.title,
        defaultPath: options.defaultPath,
        filters: options.filters?.map(filter => ({
          name: filter.name,
          extensions: filter.extensions
        })),
        properties: [
          ...(options.multiple ? ['multiSelections'] : []),
          ...(options.mode === 'directories' ? ['openDirectory'] : ['openFile']),
        ]
      });

      if (result.cancelled) {
        return { files: [], directories: [], cancelled: true };
      }

      const files: SelectedFile[] = [];
      const directories: SelectedDirectory[] = [];

      for (const filePath of result.filePaths) {
        const stats = await (window as any).electronAPI.getFileStats(filePath);
        
        if (stats.isDirectory()) {
          directories.push({
            name: filePath.split('/').pop() || filePath,
            path: filePath
          });
        } else {
          files.push({
            name: filePath.split('/').pop() || filePath,
            path: filePath,
            size: stats.size,
            type: this.getMimeType(filePath),
            lastModified: new Date(stats.mtime)
          });
        }
      }

      return { files, directories, cancelled: false };
    } catch (error) {
      console.error('Electron file picker error:', error);
      return { files: [], directories: [], cancelled: true };
    }
  }

  private getMimeType(filePath: string): string {
    const extension = filePath.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      'txt': 'text/plain',
      'json': 'application/json',
      'html': 'text/html',
      'css': 'text/css',
      'js': 'application/javascript',
      'ts': 'text/typescript',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'svg': 'image/svg+xml',
      'pdf': 'application/pdf',
      'zip': 'application/zip'
    };
    
    return mimeTypes[extension || ''] || 'application/octet-stream';
  }

  isSupported(): boolean {
    return typeof window !== 'undefined' && !!(window as any).electronAPI;
  }

  getName(): string {
    return 'Electron File Picker';
  }
}

/**
 * 文件选择器工厂
 */
export class FilePickerFactory {
  private static reactPickerFactory?: (options: FilePickerOptions) => Promise<FilePickerResult>;

  static registerReactPicker(factory: (options: FilePickerOptions) => Promise<FilePickerResult>) {
    this.reactPickerFactory = factory;
  }

  static getAvailablePickers(): FilePicker[] {
    const pickers: FilePicker[] = [];

    // React 内部浏览器（如果已注册）
    if (this.reactPickerFactory) {
      pickers.push(new ReactFilePicker(this.reactPickerFactory));
    }

    // Electron 系统对话框
    const electronPicker = new ElectronFilePicker();
    if (electronPicker.isSupported()) {
      pickers.push(electronPicker);
    }

    // Web 文件选择器
    const webPicker = new WebFilePicker();
    if (webPicker.isSupported()) {
      pickers.push(webPicker);
    }

    return pickers;
  }

  static getDefaultPicker(): FilePicker | null {
    const pickers = this.getAvailablePickers();
    return pickers.length > 0 ? pickers[0] : null;
  }

  static getPickerByName(name: string): FilePicker | null {
    const pickers = this.getAvailablePickers();
    return pickers.find(picker => picker.getName() === name) || null;
  }
}
