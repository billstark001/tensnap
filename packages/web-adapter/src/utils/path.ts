export function normalizePath(path: string): string {
  let normalized = path.replace(/\\/g, '/').replace(/\/+/g, '/');

  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }

  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized || '/';
}

export function validatePath(path: string): boolean {
  if (!path || typeof path !== 'string') return false;
  if (path.includes('..')) return false;
  if (path.includes('\0')) return false;
  return true;
}

export function getParentPath(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === '/') return '/';

  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash <= 0 ? '/' : normalized.slice(0, lastSlash);
}

export function joinPath(...paths: string[]): string {
  return normalizePath(paths.filter(Boolean).join('/'));
}

export function getPathDepth(path: string): number {
  const normalized = normalizePath(path);
  return normalized === '/' ? 0 : normalized.split('/').length - 1;
}

export function getPathComponents(path: string): string[] {
  const normalized = normalizePath(path);
  return normalized === '/' ? [] : normalized.split('/').filter(Boolean);
}

export function getBaseName(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === '/') return '';

  const lastSlash = normalized.lastIndexOf('/');
  return normalized.slice(lastSlash + 1);
}

export function calculateChecksum(content: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof content === 'string'
    ? new TextEncoder().encode(content)
    : content instanceof Uint8Array
      ? content
      : new Uint8Array(content);

  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}
