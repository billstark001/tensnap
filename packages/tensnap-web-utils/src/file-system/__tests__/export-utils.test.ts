/**
 * Tests for export-utils
 */

import { jest } from '@jest/globals';
import { exportDirectory } from '../export-utils';
import JSZip from 'jszip';
import type { FileSystemState } from 'tensnap-web/store/file-system/store';
import type { DirectoryEntry, FileContent } from 'tensnap-web/types/file';

// Helper to read blob as text (compatible with jsdom)
async function blobToText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}

// Mock FileSystemState
const createMockFileSystem = (): FileSystemState => {
  const mockFiles = new Map<string, FileContent>([
    ['/test/file1.txt', {
      metadata: {
        name: 'file1.txt',
        path: '/test/file1.txt',
        parentPath: '/test',
        size: 13,
        mimeType: 'text/plain',
        createdAt: new Date('2024-01-01'),
        modifiedAt: new Date('2024-01-01'),
      },
      content: 'Hello, World!',
      checksum: 'abc123',
    }],
    ['/test/file2.txt', {
      metadata: {
        name: 'file2.txt',
        path: '/test/file2.txt',
        parentPath: '/test',
        size: 7,
        mimeType: 'text/plain',
        createdAt: new Date('2024-01-01'),
        modifiedAt: new Date('2024-01-01'),
      },
      content: 'Testing',
      checksum: 'def456',
    }],
    ['/test/subdir/file3.txt', {
      metadata: {
        name: 'file3.txt',
        path: '/test/subdir/file3.txt',
        parentPath: '/test/subdir',
        size: 9,
        mimeType: 'text/plain',
        createdAt: new Date('2024-01-01'),
        modifiedAt: new Date('2024-01-01'),
      },
      content: 'Subfolder',
      checksum: 'ghi789',
    }],
  ]);

  const mockAdapter: any = {
    list: jest.fn(async (path: string): Promise<DirectoryEntry[]> => {
      if (path === '/test') {
        return [
          {
            type: 'file',
            name: 'file1.txt',
            path: '/test/file1.txt',
            parentPath: '/test',
            size: 13,
            mimeType: 'text/plain',
            createdAt: new Date('2024-01-01'),
            modifiedAt: new Date('2024-01-01'),
          },
          {
            type: 'file',
            name: 'file2.txt',
            path: '/test/file2.txt',
            parentPath: '/test',
            size: 7,
            mimeType: 'text/plain',
            createdAt: new Date('2024-01-01'),
            modifiedAt: new Date('2024-01-01'),
          },
          {
            type: 'directory',
            name: 'subdir',
            path: '/test/subdir',
            parentPath: '/test',
            createdAt: new Date('2024-01-01'),
            modifiedAt: new Date('2024-01-01'),
          },
        ];
      } else if (path === '/test/subdir') {
        return [
          {
            type: 'file',
            name: 'file3.txt',
            path: '/test/subdir/file3.txt',
            parentPath: '/test/subdir',
            size: 9,
            mimeType: 'text/plain',
            createdAt: new Date('2024-01-01'),
            modifiedAt: new Date('2024-01-01'),
          },
        ];
      }
      return [];
    }),
  };

  return {
    adapter: mockAdapter,
    readFile: jest.fn(async (path: string) => mockFiles.get(path) || null),
  } as any;
};

describe('exportDirectory', () => {
  describe('JSON export', () => {
    it('should export directory as JSON', async () => {
      const mockFS = createMockFileSystem();
      const blob = await exportDirectory(mockFS, '/test', { format: 'json' });

      expect(blob.type).toBe('application/json');

      const text = await blobToText(blob);
      const data = JSON.parse(text);

      expect(data.path).toBe('/test');
      expect(data.files).toHaveLength(2);
      expect(data.subdirectories).toHaveLength(1);
    });

    it('should include file contents as base64', async () => {
      const mockFS = createMockFileSystem();
      const blob = await exportDirectory(mockFS, '/test', { format: 'json' });

      const text = await blobToText(blob);
      const data = JSON.parse(text);

      const file1 = data.files.find((f: any) => f.name === 'file1.txt');
      expect(file1).toBeDefined();
      expect(file1.content).toBeTruthy();
      
      // Decode base64 and check content
      const decoded = atob(file1.content);
      expect(decoded).toBe('Hello, World!');
    });

    it('should recursively export subdirectories', async () => {
      const mockFS = createMockFileSystem();
      const blob = await exportDirectory(mockFS, '/test', { format: 'json' });

      const text = await blobToText(blob);
      const data = JSON.parse(text);

      const subdir = data.subdirectories[0];
      expect(subdir.path).toBe('/test/subdir');
      expect(subdir.files).toHaveLength(1);
      expect(subdir.files[0].name).toBe('file3.txt');
    });
  });

  describe('ZIP export', () => {
    it('should export directory as ZIP', async () => {
      const mockFS = createMockFileSystem();
      const blob = await exportDirectory(mockFS, '/test', { format: 'zip' });

      expect(blob.type).toBe('application/zip');

      // Verify ZIP contents
      const zip = await JSZip.loadAsync(blob);
      const files = Object.keys(zip.files);
      
      expect(files).toContain('file1.txt');
      expect(files).toContain('file2.txt');
      expect(files).toContain('subdir/file3.txt');
    });

    it('should preserve file contents in ZIP', async () => {
      const mockFS = createMockFileSystem();
      const blob = await exportDirectory(mockFS, '/test', { format: 'zip' });

      const zip = await JSZip.loadAsync(blob);
      const file1Content = await zip.file('file1.txt')?.async('text');
      
      expect(file1Content).toBe('Hello, World!');
    });

    it('should preserve directory structure in ZIP', async () => {
      const mockFS = createMockFileSystem();
      const blob = await exportDirectory(mockFS, '/test', { format: 'zip' });

      const zip = await JSZip.loadAsync(blob);
      const subFile = await zip.file('subdir/file3.txt')?.async('text');
      
      expect(subFile).toBe('Subfolder');
    });
  });

  describe('Error handling', () => {
    it('should throw error for unsupported format', async () => {
      const mockFS = createMockFileSystem();

      await expect(
        exportDirectory(mockFS, '/test', { format: 'tar' as any })
      ).rejects.toThrow('Unsupported export format');
    });
  });
});
