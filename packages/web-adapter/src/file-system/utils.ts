/**
 * 工具函数：文件系统相关的辅助功能
 */

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
 * 规范化路径（移除多余的斜杠，确保一致性）
 */
export function normalizePath(path: string): string {
  // 移除末尾的斜杠（除了根路径）
  if (path !== '/' && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  // 替换多个连续斜杠为单个
  path = path.replace(/\/+/g, '/');
  // 确保以斜杠开头
  if (!path.startsWith('/')) {
    path = '/' + path;
  }
  return path;
}

/**
 * 连接路径
 */
export function joinPath(...parts: string[]): string {
  const joined = parts
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/');
  return normalizePath(joined);
}

/**
 * 获取父路径
 */
export function getParentPath(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === '/') return '/';
  
  const lastSlashIndex = normalized.lastIndexOf('/');
  if (lastSlashIndex === 0) return '/';
  
  return normalized.slice(0, lastSlashIndex);
}

/**
 * 获取文件/目录名称
 */
export function getBaseName(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === '/') return '';
  
  const lastSlashIndex = normalized.lastIndexOf('/');
  return normalized.slice(lastSlashIndex + 1);
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
  const invalidChars = /[<>:"|?*\/\\]/;
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

/**
 * 计算简单的校验和（用于文件内容验证）
 */
export function calculateChecksum(content: ArrayBuffer | string): string {
  let hash = 0;
  const str = typeof content === 'string' 
    ? content 
    : new TextDecoder().decode(new Uint8Array(content));
  
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  return Math.abs(hash).toString(16);
}
