/**
 * Export utilities for filesystem
 * 
 * These utilities provide export functionality independent of the filesystem adapter.
 * They work by reading files/directories using the basic read operations.
 */

import JSZip from 'jszip';
import { FileSystemAdapter } from '@tensnap/web-common/types/file';

export interface ExportOptions {
  format: 'json' | 'zip';
}

/**
 * Export a directory and all its contents
 */
export async function exportDirectory(
  fileSystem: FileSystemAdapter,
  path: string,
  options: ExportOptions = { format: 'json' }
): Promise<Blob> {
  const { format } = options;
  
  if (format === 'json') {
    return await exportAsJSON(fileSystem, path);
  } else if (format === 'zip') {
    return await exportAsZip(fileSystem, path);
  }
  
  throw new Error(`Unsupported export format: ${format}`);
}

/**
 * Export directory as JSON
 */
async function exportAsJSON(
  fileSystem: FileSystemAdapter,
  path: string
): Promise<Blob> {
  const tree = await buildDirectoryTree(fileSystem, path);
  const json = JSON.stringify(tree, null, 2);
  return new Blob([json], { type: 'application/json' });
}

/**
 * Export directory as ZIP
 */
async function exportAsZip(
  fileSystem: FileSystemAdapter,
  path: string
): Promise<Blob> {
  const zip = new JSZip();
  await addDirectoryToZip(fileSystem, path, zip, '');
  return await zip.generateAsync({ type: 'blob' });
}

/**
 * Build a directory tree structure
 */
async function buildDirectoryTree(
  fileSystem: FileSystemAdapter,
  path: string
): Promise<any> {
  const contents = await fileSystem.list(path);
  
  const tree: any = {
    path,
    files: [],
    subdirectories: []
  };
  
  for (const entry of contents) {
    if (entry.type === 'file') {
      const fileContent = await fileSystem.readFile(entry.path);
      if (fileContent) {
        // Convert ArrayBuffer to base64 for JSON serialization
        const contentBase64 = arrayBufferToBase64(fileContent.content);
        tree.files.push({
          ...entry,
          content: contentBase64,
          checksum: fileContent.checksum
        });
      }
    } else {
      const subTree = await buildDirectoryTree(fileSystem, entry.path);
      tree.subdirectories.push(subTree);
    }
  }
  
  return tree;
}

/**
 * Add directory contents to ZIP
 */
async function addDirectoryToZip(
  fileSystem: FileSystemAdapter,
  dirPath: string,
  zip: JSZip,
  zipPath: string
): Promise<void> {
  const contents = await fileSystem.list(dirPath);
  
  for (const entry of contents) {
    const entryZipPath = zipPath ? `${zipPath}/${entry.name}` : entry.name;
    
    if (entry.type === 'file') {
      const fileContent = await fileSystem.readFile(entry.path);
      if (fileContent) {
        zip.file(entryZipPath, fileContent.content);
      }
    } else {
      await addDirectoryToZip(fileSystem, entry.path, zip, entryZipPath);
    }
  }
}

/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer | string): string {
  if (typeof buffer === 'string') {
    return btoa(buffer);
  }
  
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
