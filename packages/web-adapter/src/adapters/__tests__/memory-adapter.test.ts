/**
 * Tests for MemoryFileSystemAdapter
 */

import { MemoryFileSystemAdapter } from '../memory-adapter';

describe('MemoryFileSystemAdapter', () => {
  let adapter: MemoryFileSystemAdapter;

  beforeEach(async () => {
    adapter = new MemoryFileSystemAdapter();
    await adapter.initialize();
  });

  afterEach(async () => {
    await adapter.cleanup();
  });

  describe('initialization', () => {
    it('should initialize with root directory', async () => {
      const exists = await adapter.directoryExists('/');
      expect(exists).toBe(true);
    });
  });

  describe('file operations', () => {
    it('should write and read a file', async () => {
      const content = 'Hello, World!';
      const file = await adapter.writeFile('/test.txt', content);

      expect(file.metadata.path).toBe('/test.txt');
      expect(file.metadata.name).toBe('test.txt');
      expect(file.content).toBe(content);

      const readFile = await adapter.readFile('/test.txt');
      expect(readFile).not.toBeNull();
      expect(readFile!.content).toBe(content);
    });

    it('should delete a file', async () => {
      await adapter.writeFile('/test.txt', 'content');
      
      const exists1 = await adapter.fileExists('/test.txt');
      expect(exists1).toBe(true);

      await adapter.deleteFile('/test.txt');

      const exists2 = await adapter.fileExists('/test.txt');
      expect(exists2).toBe(false);
    });

    it('should return null for non-existent file', async () => {
      const file = await adapter.readFile('/nonexistent.txt');
      expect(file).toBeNull();
    });
  });

  describe('directory operations', () => {
    it('should create and list directories', async () => {
      await adapter.createDirectory('/testdir');

      const exists = await adapter.directoryExists('/testdir');
      expect(exists).toBe(true);
    });

    it('should delete empty directory', async () => {
      await adapter.createDirectory('/testdir');
      await adapter.deleteDirectory('/testdir');

      const exists = await adapter.directoryExists('/testdir');
      expect(exists).toBe(false);
    });

    it('should delete directory recursively', async () => {
      await adapter.createDirectory('/testdir');
      await adapter.writeFile('/testdir/file.txt', 'content');
      
      await adapter.deleteDirectory('/testdir', true);

      const exists = await adapter.directoryExists('/testdir');
      expect(exists).toBe(false);
    });

    it('should throw error when deleting non-empty directory without recursive flag', async () => {
      await adapter.createDirectory('/testdir');
      await adapter.writeFile('/testdir/file.txt', 'content');

      await expect(adapter.deleteDirectory('/testdir', false)).rejects.toThrow();
    });
  });

  describe('list operations', () => {
    it('should list directory contents', async () => {
      await adapter.createDirectory('/testdir');
      await adapter.writeFile('/testdir/file1.txt', 'content1');
      await adapter.writeFile('/testdir/file2.txt', 'content2');
      await adapter.createDirectory('/testdir/subdir');

      const contents = await adapter.list('/testdir');

      expect(contents).toHaveLength(3);
      
      const file1 = contents.find(e => e.name === 'file1.txt');
      expect(file1?.type).toBe('file');

      const subdir = contents.find(e => e.name === 'subdir');
      expect(subdir?.type).toBe('directory');
    });

    it('should list root directory', async () => {
      await adapter.writeFile('/file.txt', 'content');
      await adapter.createDirectory('/dir');

      const contents = await adapter.list('/');

      expect(contents.length).toBeGreaterThan(0);
      const file = contents.find(e => e.name === 'file.txt');
      expect(file).toBeDefined();
    });
  });

  describe('stats', () => {
    it('should return filesystem stats', async () => {
      await adapter.writeFile('/file1.txt', 'content1');
      await adapter.writeFile('/file2.txt', 'content2');
      await adapter.createDirectory('/dir1');

      const stats = await adapter.getStats();

      expect(stats.totalFiles).toBe(2);
      expect(stats.totalDirectories).toBeGreaterThanOrEqual(1); // At least /dir1, root is excluded
      expect(stats.totalSize).toBeGreaterThan(0);
    });
  });
});
