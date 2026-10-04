import { describe, expect, it, vi } from 'vitest';
import { AssetStore } from './AssetStore';

describe('AssetStore binary string decoding', () => {
  it('accepts data-url encoded JSON asset payloads', async () => {
    const store = new AssetStore();

    await store.receiveData(
      'asset-1',
      'hash-1',
      'application/json',
      'data:application/json;base64,eyJvayI6dHJ1ZX0=',
    );

    expect(store.get('asset-1')?.url).toBe('{"ok":true}');
  });

  it('keeps bare base64 support for existing JSON asset payloads', async () => {
    const store = new AssetStore();

    await store.receiveData(
      'asset-2',
      'hash-2',
      'text/plain',
      'aGVsbG8=',
    );

    expect(store.get('asset-2')?.url).toBe('hello');
  });

  it('exposes SVG image assets as browser-safe data URLs while preserving source text', async () => {
    const store = new AssetStore();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';

    await store.receiveData(
      'asset-3',
      'hash-3',
      'image/svg+xml',
      new TextEncoder().encode(svg),
    );

    const asset = store.get('asset-3');
    expect(asset?.url).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(asset?.source).toBe(svg);
    expect(store.getUrl('asset-3')).toBe(asset?.url);
  });

  it('round-trips binary assets through JSON-safe snapshot data', async () => {
    const source = new AssetStore();
    source.receiveMeta({ id: 'sprite', hash: 'abc', mime: 'image/png', size: 3 });
    await source.receiveData('sprite', 'abc', 'image/png', new Uint8Array([1, 2, 3]));
    const persisted = JSON.parse(JSON.stringify(source.dump()));
    source.destroy();

    const restored = new AssetStore();
    restored.load(persisted);
    expect(restored.get('sprite')?.source).toEqual(new Uint8Array([1, 2, 3]));
    restored.destroy();
  });

  it('ignores late data for a superseded hash', async () => {
    const store = new AssetStore();
    store.receiveMeta({ id: 'sprite', hash: 'new', mime: 'text/plain', size: 3 });
    await store.receiveData('sprite', 'old', 'text/plain', new TextEncoder().encode('old'));
    expect(store.get('sprite')).toBeUndefined();
    expect(store.getMeta('sprite')?.hash).toBe('new');
    await store.receiveData('sprite', 'new', 'text/plain', new TextEncoder().encode('new'));
    expect(store.get('sprite')?.url).toBe('new');
  });

  it('accepts a newer hash when data arrives without a metadata announcement', async () => {
    const store = new AssetStore();
    await store.receiveData('asset', 'one', 'text/plain', new Uint8Array([65]));
    await store.receiveData('asset', 'two', 'text/plain', new Uint8Array([66]));
    expect(store.get('asset')?.hash).toBe('two');
    expect(store.getUrl('asset')).toBe('B');
  });

  it('releases an image URL when later data for the same id is text', async () => {
    const store = new AssetStore();
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    await store.receiveData('asset', 'one', 'image/png', new Uint8Array([1, 2, 3]));
    const imageUrl = store.getUrl('asset');
    await store.receiveData('asset', 'one', 'text/plain', new TextEncoder().encode('hello'));
    expect(revoke).toHaveBeenCalledWith(imageUrl);
    expect(store.getUrl('asset')).toBe('hello');
    store.destroy();
    revoke.mockRestore();
  });

  it('keeps the previous image usable if replacement URL creation fails', async () => {
    const store = new AssetStore();
    await store.receiveData('asset', 'one', 'image/png', new Uint8Array([1]));
    const previousUrl = store.getUrl('asset');
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementationOnce(() => {
      throw new Error('URL unavailable');
    });
    const revoke = vi.spyOn(URL, 'revokeObjectURL');

    await expect(store.receiveData('asset', 'two', 'image/png', new Uint8Array([2])))
      .rejects.toThrow('URL unavailable');
    expect(store.getUrl('asset')).toBe(previousUrl);
    expect(revoke).not.toHaveBeenCalledWith(previousUrl);

    create.mockRestore();
    revoke.mockRestore();
    store.destroy();
  });

  it('includes prototype-shaped ids in held hashes', async () => {
    const store = new AssetStore();
    await store.receiveData('__proto__', 'hash', 'text/plain', new Uint8Array([65]));
    expect(JSON.parse(JSON.stringify(store.getHeldHashes()))).toEqual(Object.fromEntries([['__proto__', 'hash']]));
  });
});
