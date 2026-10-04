import { describe, expect, it, vi } from 'vitest';
import type { DirectoryEntry, FileSystemAdapter } from '@tensnap/web-common/types/file';
import { createFileSystemStore } from './store';

describe('file system store', () => {
  it('reports a missing picker with a useful error', async () => {
    const store = createFileSystemStore({} as FileSystemAdapter, 'test');
    await expect(store.getState().pickFiles()).rejects.toThrow('No file picker registered');
  });

  it('discards a directory listing that finishes after navigation', async () => {
    let finishOld!: (entries: DirectoryEntry[]) => void;
    const oldListing = new Promise<DirectoryEntry[]>((resolve) => { finishOld = resolve; });
    const adapter = {
      initialize: vi.fn(async () => {}),
      list: vi.fn((path: string) => path === '/old' ? oldListing : Promise.resolve([])),
      getStats: vi.fn(async () => ({ totalFiles: 0, totalDirectories: 0, totalSize: 0 })),
      directoryExists: vi.fn(async () => true),
    } as unknown as FileSystemAdapter;
    const store = createFileSystemStore(adapter, 'test');
    await store.getState().initialize();

    const oldNavigation = store.getState().setCurrentDirectory('/old');
    await vi.waitFor(() => expect(adapter.list).toHaveBeenCalledWith('/old'));
    await store.getState().setCurrentDirectory('/new');
    finishOld([{ type: 'directory', name: 'old', path: '/old/old', parentPath: '/old', createdAt: new Date(), modifiedAt: new Date() }]);
    await oldNavigation;

    expect(store.getState().currentDirectory).toBe('/new');
    expect(store.getState().directoryContents).toEqual([]);
  });

  it('keeps loading active until overlapping writes finish', async () => {
    let finishFirst!: (value: never) => void;
    let finishSecond!: (value: never) => void;
    const first = new Promise<never>((resolve) => { finishFirst = resolve; });
    const second = new Promise<never>((resolve) => { finishSecond = resolve; });
    const adapter = {
      initialize: vi.fn(async () => {}),
      list: vi.fn(async () => []),
      getStats: vi.fn(async () => ({ totalFiles: 0, totalDirectories: 0, totalSize: 0 })),
      writeFile: vi.fn((path: string) => path === '/first' ? first : second),
    } as unknown as FileSystemAdapter;
    const store = createFileSystemStore(adapter, 'test');
    await store.getState().initialize();

    const firstWrite = store.getState().writeFile('/first', 'a');
    const secondWrite = store.getState().writeFile('/second', 'b');
    expect(store.getState().loading).toBe(true);
    finishFirst({} as never);
    await firstWrite;
    expect(store.getState().loading).toBe(true);
    finishSecond({} as never);
    await secondWrite;
    expect(store.getState().loading).toBe(false);
  });

  it('shares one adapter initialization among concurrent first operations', async () => {
    let finishInitialization!: () => void;
    const wait = new Promise<void>((resolve) => { finishInitialization = resolve; });
    const adapter = {
      initialize: vi.fn(() => wait),
      list: vi.fn(async () => []),
      getStats: vi.fn(async () => ({ totalFiles: 0, totalDirectories: 0, totalSize: 0 })),
      readFile: vi.fn(async () => null),
    } as unknown as FileSystemAdapter;
    const store = createFileSystemStore(adapter, 'test');
    const first = store.getState().readFile('/a');
    const second = store.getState().readFile('/b');
    expect(adapter.initialize).toHaveBeenCalledTimes(1);
    finishInitialization();
    await Promise.all([first, second]);
    expect(adapter.readFile).toHaveBeenCalledTimes(2);
  });
});
