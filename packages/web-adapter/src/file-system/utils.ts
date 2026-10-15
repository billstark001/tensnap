import {
  calculateChecksum,
  getBaseName,
  getParentPath,
  joinPath,
  normalizePath,
} from '../utils/path';

export { calculateChecksum, getBaseName, getParentPath, joinPath, normalizePath };

/**
 * Format a byte count using powers of 1024 and at most one decimal place.
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Format a date and time using the current locale.
 */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * Build breadcrumbs containing the root and each cumulative path segment.
 */
export function parseBreadcrumbs(path: string): Array<{ name: string; path: string }> {
  const normalized = normalizePath(path);

  if (normalized === '/') {
    return [{ name: '/', path: '/' }];
  }

  const parts = normalized.split('/').filter(Boolean);
  const breadcrumbs: Array<{ name: string; path: string }> = [{ name: '/', path: '/' }];

  let currentPath = '';
  for (const part of parts) {
    currentPath += '/' + part;
    breadcrumbs.push({
      name: part,
      path: currentPath,
    });
  }

  return breadcrumbs;
}

/**
 * Validate a single file or directory name, rejecting separators and reserved dot names.
 */
export function validateName(name: string): { valid: boolean; error?: string } {
  if (!name || name.trim() === '') {
    return { valid: false, error: 'Name cannot be empty' };
  }

  const invalidChars = /[<>:"|?*/\\]/;
  if (invalidChars.test(name)) {
    return { valid: false, error: 'Name contains invalid characters' };
  }

  const reserved = ['.', '..'];
  if (reserved.includes(name.trim())) {
    return { valid: false, error: 'Name cannot be a reserved keyword' };
  }

  return { valid: true };
}

/**
 * Read the complete file as an ArrayBuffer, rejecting on read failure.
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
