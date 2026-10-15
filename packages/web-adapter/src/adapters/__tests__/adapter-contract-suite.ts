import type { FileSystemAdapter } from '@tensnap/web-common/types/file';

type AdapterFactoryResult = {
  adapter: FileSystemAdapter;
  cleanup?: () => Promise<void> | void;
};

type AdapterFactory = () => Promise<AdapterFactoryResult>;

export function runFileSystemAdapterContractSuite(
  name: string,
  createAdapter: AdapterFactory,
): void {
  describe(name, () => {
    let adapter: FileSystemAdapter;
    let teardown: (() => Promise<void> | void) | undefined;

    beforeEach(async () => {
      const result = await createAdapter();
      adapter = result.adapter;
      teardown = result.cleanup;
      await adapter.initialize();
    });

    afterEach(async () => {
      await adapter.cleanup();
      await teardown?.();
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

        const readFile = await adapter.readFile('/test.txt');
        expect(readFile).not.toBeNull();
        expect(readFile!.content).toBe(content);
      });

      it('should write and read binary file', async () => {
        const content = new Uint8Array([1, 2, 3, 4, 5]).buffer;
        await adapter.writeFile('/binary.dat', content);

        const readFile = await adapter.readFile('/binary.dat');
        expect(readFile).not.toBeNull();

        const readArray = new Uint8Array(readFile!.content as ArrayBuffer);
        expect(Array.from(readArray)).toEqual([1, 2, 3, 4, 5]);
      });

      it('owns persisted bytes and metadata independently of callers', async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const tags = ['original'];
        const written = await adapter.writeFile('/owned.bin', bytes.buffer, { tags });
        bytes[0] = 9;
        tags.push('external');
        written.metadata.tags?.push('returned');
        written.metadata.createdAt.setFullYear(1900);
        new Uint8Array(written.content as ArrayBuffer)[1] = 9;
        const first = (await adapter.readFile('/owned.bin'))!;
        expect(Array.from(new Uint8Array(first.content as ArrayBuffer))).toEqual([1, 2, 3]);
        expect(first.metadata.tags).toEqual(['original']);
        expect(first.metadata.createdAt.getFullYear()).not.toBe(1900);
        first.metadata.name = 'changed';
        new Uint8Array(first.content as ArrayBuffer)[2] = 9;
        const second = (await adapter.readFile('/owned.bin'))!;
        expect(second.metadata.name).toBe('owned.bin');
        expect(Array.from(new Uint8Array(second.content as ArrayBuffer))).toEqual([1, 2, 3]);
        expect(second.checksum).toBe(first.checksum);
        const entries = await adapter.list('/');
        entries.find((entry) => entry.path === '/owned.bin')!.tags!.push('listed');
        expect((await adapter.readFile('/owned.bin'))!.metadata.tags).toEqual(['original']);
      });

      it('keeps file and directory paths mutually exclusive', async () => {
        await adapter.createDirectory('/folder');
        await expect(adapter.writeFile('/folder', 'data')).rejects.toMatchObject({
          code: 'INVALID_OPERATION',
        });
        await expect(adapter.writeFile('/', 'data')).rejects.toMatchObject({
          code: 'INVALID_OPERATION',
        });
        await adapter.writeFile('/file', 'data');
        await expect(adapter.createDirectory('/file', true)).rejects.toMatchObject({
          code: 'PATH_EXISTS',
        });
        await expect(adapter.writeFile('/file/child', 'data')).rejects.toMatchObject({
          code: 'INVALID_OPERATION',
        });
        expect(await adapter.directoryExists('/file')).toBe(false);
        expect((await adapter.readFile('/file'))!.content).toBe('data');
      });

      it('should delete a file', async () => {
        await adapter.writeFile('/test.txt', 'content');
        expect(await adapter.fileExists('/test.txt')).toBe(true);

        await adapter.deleteFile('/test.txt');
        expect(await adapter.fileExists('/test.txt')).toBe(false);
      });

      it('should return null for non-existent file', async () => {
        const file = await adapter.readFile('/nonexistent.txt');
        expect(file).toBeNull();
      });
    });

    describe('directory operations', () => {
      it('should create and list directories', async () => {
        await adapter.createDirectory('/testdir');
        expect(await adapter.directoryExists('/testdir')).toBe(true);
      });

      it('should delete empty directory', async () => {
        await adapter.createDirectory('/testdir');
        await adapter.deleteDirectory('/testdir');

        expect(await adapter.directoryExists('/testdir')).toBe(false);
      });

      it('should delete directory recursively', async () => {
        await adapter.createDirectory('/testdir');
        await adapter.writeFile('/testdir/file.txt', 'content');

        await adapter.deleteDirectory('/testdir', true);

        expect(await adapter.directoryExists('/testdir')).toBe(false);
      });

      it('deletes only descendants across nested directories and shared name prefixes', async () => {
        await adapter.writeFile('/tree/a/b/c/file.txt', 'inside');
        await adapter.writeFile('/tree-also/file.txt', 'outside');
        await adapter.deleteDirectory('/tree', true);
        expect(await adapter.directoryExists('/tree/a/b/c')).toBe(false);
        expect(await adapter.fileExists('/tree/a/b/c/file.txt')).toBe(false);
        expect((await adapter.readFile('/tree-also/file.txt'))!.content).toBe('outside');
      });

      it('returns detached directory metadata', async () => {
        const created = await adapter.createDirectory('/folder');
        created.name = 'changed';
        created.createdAt.setFullYear(1900);
        const read = await adapter.createDirectory('/folder', true);
        expect(read.name).toBe('folder');
        expect(read.createdAt.getFullYear()).not.toBe(1900);
      });

      it('should throw error when deleting non-empty directory without recursive flag', async () => {
        await adapter.createDirectory('/testdir');
        await adapter.writeFile('/testdir/file.txt', 'content');

        await expect(adapter.deleteDirectory('/testdir', false)).rejects.toThrow();
      });

      it('should not allow deleting root directory', async () => {
        await expect(adapter.deleteDirectory('/')).rejects.toThrow();
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

        const file1 = contents.find((entry) => entry.name === 'file1.txt');
        expect(file1?.type).toBe('file');

        const subdir = contents.find((entry) => entry.name === 'subdir');
        expect(subdir?.type).toBe('directory');
      });

      it('should list root directory', async () => {
        await adapter.writeFile('/file.txt', 'content');
        await adapter.createDirectory('/dir');

        const contents = await adapter.list('/');
        expect(contents.length).toBeGreaterThan(0);

        const file = contents.find((entry) => entry.name === 'file.txt');
        expect(file).toBeDefined();
      });

      it('should return empty array for empty directory', async () => {
        await adapter.createDirectory('/emptydir');
        const contents = await adapter.list('/emptydir');
        expect(contents).toHaveLength(0);
      });
    });

    describe('stats', () => {
      it('should return filesystem stats', async () => {
        await adapter.writeFile('/file1.txt', 'content1');
        await adapter.writeFile('/file2.txt', 'content2');
        await adapter.createDirectory('/dir1');

        const stats = await adapter.getStats();

        expect(stats.totalFiles).toBeGreaterThanOrEqual(2);
        expect(stats.totalDirectories).toBeGreaterThanOrEqual(1);
        expect(stats.totalSize).toBeGreaterThan(0);
      });
    });

    describe('path normalization', () => {
      it('should handle paths with trailing slashes', async () => {
        await adapter.createDirectory('/testdir/', true);
        expect(await adapter.directoryExists('/testdir')).toBe(true);
      });

      it('should handle nested directory creation', async () => {
        await adapter.createDirectory('/parent', true);
        await adapter.createDirectory('/parent/child', true);

        expect(await adapter.directoryExists('/parent/child')).toBe(true);
      });

      it('should create missing parent directories when writing a file', async () => {
        await adapter.writeFile('/deep/nested/file.txt', 'content');

        expect(await adapter.directoryExists('/deep')).toBe(true);
        expect(await adapter.directoryExists('/deep/nested')).toBe(true);
        expect(await adapter.fileExists('/deep/nested/file.txt')).toBe(true);
      });
    });
  });
}
