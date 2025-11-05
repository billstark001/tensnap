
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

/**
 * Validate path for security and correctness
 */
export function validatePath(path: string): boolean {
  if (!path || typeof path !== 'string') return false;
  if (path.includes('..')) return false; // Prevent directory traversal
  if (path.includes('\0')) return false; // Null bytes not allowed
  return true;
}

/**
 * Resolve and normalize a path
 */
export function resolvePath(path: string): string {
  return normalizePath(path);
}

/**
 * Get parent directory path
 */
export function getParentPath(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === '/') return '';

  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash <= 0 ? '/' : normalized.substring(0, lastSlash);
}

/**
 * Join multiple path segments
 */
export function joinPaths(...paths: string[]): string {
  return normalizePath(paths.join('/'));
}

/**
 * Get the depth of a path (number of directory levels)
 */
export function getPathDepth(path: string): number {
  const normalized = normalizePath(path);
  return normalized === '/' ? 0 : normalized.split('/').length - 1;
}

/**
 * Get path components as array
 */
export function getPathComponents(path: string): string[] {
  const normalized = normalizePath(path);
  return normalized === '/' ? [] : normalized.split('/').filter(Boolean);
}

/**
 * Calculate simple checksum for content
 */
export function calculateChecksum(content: ArrayBuffer | Uint8Array | string): string {
  const str = typeof content === 'string' ? content : new TextDecoder().decode(content);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(16);
}