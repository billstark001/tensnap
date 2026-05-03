import {
  calculateChecksum,
  getBaseName,
  getParentPath,
  joinPath,
  normalizePath,
} from '../utils/path';

/**
 * 工具函数：文件系统相关的辅助功能
 */

export {
  calculateChecksum,
  getBaseName,
  getParentPath,
  joinPath,
  normalizePath,
};

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * 格式化日期
 */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

/**
 * 解析路径为面包屑数组
 */
export function parseBreadcrumbs(path: string): Array<{ name: string; path: string }> {
  const normalized = normalizePath(path);
  
  if (normalized === '/') {
    return [{ name: '/', path: '/' }];
  }
  
  const parts = normalized.split('/').filter(Boolean);
  const breadcrumbs: Array<{ name: string; path: string }> = [
    { name: '/', path: '/' }
  ];
  
  let currentPath = '';
  for (const part of parts) {
    currentPath += '/' + part;
    breadcrumbs.push({
      name: part,
      path: currentPath
    });
  }
  
  return breadcrumbs;
}

/**
 * 验证文件/目录名称
 */
export function validateName(name: string): { valid: boolean; error?: string } {
  if (!name || name.trim() === '') {
    return { valid: false, error: 'Name cannot be empty' };
  }
  
  // 检查非法字符
  const invalidChars = /[<>:"|?*/\\]/;
  if (invalidChars.test(name)) {
    return { valid: false, error: 'Name contains invalid characters' };
  }
  
  // 检查保留名称
  const reserved = ['.', '..'];
  if (reserved.includes(name.trim())) {
    return { valid: false, error: 'Name cannot be a reserved keyword' };
  }
  
  return { valid: true };
}

/**
 * 从 File 对象读取内容
 */
export function readFileContent(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read file as ArrayBuffer'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

