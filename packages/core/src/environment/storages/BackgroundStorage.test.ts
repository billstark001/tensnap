import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackgroundStorage, loadImageAsync } from './BackgroundStorage';

const images: FakeImage[] = [];

class FakeImage {
  style = { imageRendering: '', setProperty: vi.fn() };
  crossOrigin = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';

  constructor() {
    images.push(this);
  }
}

afterEach(() => {
  images.length = 0;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('BackgroundStorage', () => {
  it('ignores an older image that loads after a newer background', async () => {
    vi.stubGlobal('Image', FakeImage);
    const storage = new BackgroundStorage();
    const oldLoad = storage.setBackground('https://example.test/old.png');
    const newLoad = storage.setBackground('https://example.test/new.png');
    images[1].onload?.();
    await newLoad;
    images[0].onload?.();
    await oldLoad;

    expect(storage.getData()).toEqual({
      kind: 'image',
      url: 'https://example.test/new.png',
      isBlob: false,
      interpolation: 'nearest',
    });
  });

  it('never revokes an asset store URL supplied by the caller', () => {
    vi.useFakeTimers();
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { revokeObjectURL }));
    const storage = new BackgroundStorage();
    storage.setBackgroundUrl('blob:asset-store');
    storage.setBackgroundUrl(null);
    vi.runAllTimers();
    storage.destroy();
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });

  it('releases every owned URL after rapid replacements and on destroy', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Image', FakeImage);
    const revokeObjectURL = vi.fn();
    let id = 0;
    vi.stubGlobal(
      'URL',
      Object.assign(class extends URL {}, {
        createObjectURL: vi.fn(() => `blob:owned-${++id}`),
        revokeObjectURL,
      }),
    );
    const storage = new BackgroundStorage();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    for (let index = 0; index < 3; index++) {
      const load = storage.setBackground(png);
      await Promise.resolve();
      images[index].onload?.();
      await load;
    }

    vi.advanceTimersByTime(200);
    expect(revokeObjectURL.mock.calls.map(([url]) => url)).toEqual([
      'blob:owned-1',
      'blob:owned-2',
    ]);
    storage.destroy();
    expect(revokeObjectURL.mock.calls.map(([url]) => url)).toEqual([
      'blob:owned-1',
      'blob:owned-2',
      'blob:owned-3',
    ]);
  });

  it('rejects a failed image load instead of leaving its promise pending', async () => {
    vi.stubGlobal('Image', FakeImage);
    const load = loadImageAsync('https://example.test/missing.png');
    images[0].onerror?.();
    await expect(load).rejects.toThrow(/Failed to load background image/);
  });
});
