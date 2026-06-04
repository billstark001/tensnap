import { describe, expect, it } from 'vitest';
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
});
