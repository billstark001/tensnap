/**
 * Filesystem Adapters
 * 
 * This module provides filesystem adapter implementations for different storage backends:
 * - MemoryFileSystemAdapter: In-memory filesystem (for testing and demos)
 * - IndexedDBFileSystemAdapter: Browser IndexedDB storage
 */

export { FileSystemAdapter } from './adapter';
export { MemoryFileSystemAdapter } from './memory-adapter';
export { IndexedDBFileSystemAdapter } from './indexeddb-adapter';

export type { FileSystemAdapterFactory } from './adapter';
