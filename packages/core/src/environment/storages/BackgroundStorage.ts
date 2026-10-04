/**
 * environment/storages/BackgroundStorage.ts
 *
 * Manages background data: CSS colors, image URLs, and binary blobs (NPY/PNG/JPEG).
 * Resolves raw input into a canonical form (color string or object-URL / data-URL)
 * and notifies subscribers.
 */

import { BaseStorage } from './BaseStorage';
import { isCssColor } from '../utils/color';
import { NPYParser } from '../../utils/npy-parser';
import { createNumpyBackground } from '../../utils/numpy-renderer';
import { uint8ArrayToArrayBuffer } from '../../utils/msgpack';
import { detectFileFormat } from '../../utils/format-detector';
import type { BackgroundInterpolation } from '@tensnap/protocol/layers';

// ---------------------------------------------------------------------------
// Data type
// ---------------------------------------------------------------------------

export type BackgroundValue =
  | { kind: 'color'; value: string }
  | { kind: 'image'; url: string; isBlob: boolean; interpolation: BackgroundInterpolation };

export type BackgroundData = BackgroundValue | null;

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export class BackgroundStorage extends BaseStorage<BackgroundData> {
  /** Blob URL created by this storage; asset URLs belong to AssetStore. */
  private _blobUrl: string | null = null;
  private readonly _cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private _requestGeneration = 0;

  constructor() {
    super(null);
  }

  override dump(): BackgroundData {
    return this._data ? { ...this._data } : null;
  }

  override load(snapshot: unknown): void {
    this._requestGeneration += 1;
    this._setResolved((snapshot as BackgroundData) ?? null);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Accept raw background input, resolve it asynchronously, and notify.
   * Resolves only the latest request; a superseded image cannot replace a
   * newer background. Rejects when an image cannot be decoded or loaded.
   * @param interpolation Image interpolation mode. Defaults to 'nearest'.
   */
  async setBackground(
    background: string | Uint8Array | undefined,
    interpolation: BackgroundInterpolation = 'nearest',
  ): Promise<void> {
    const generation = ++this._requestGeneration;
    if (background === undefined || background === null) {
      this._setResolved(null);
      return;
    }

    if (typeof background === 'string') {
      if (isCssColor(background)) {
        this._setResolved({ kind: 'color', value: background });
      } else {
        // Image URL (including blob-URLs from AssetStore) — resolve via Image().
        const img = await loadImageAsync(background, interpolation);
        if (generation !== this._requestGeneration) return;
        const isBlob = background.startsWith('blob:');
        this._setResolved({ kind: 'image', url: img.src, isBlob, interpolation });
      }
      return;
    }

    // Uint8Array — detect format and decode
    const url = await parseUint8ArrayBackground(background, interpolation);
    const ownedUrl = url.startsWith('blob:') ? url : null;
    try {
      if (generation !== this._requestGeneration) return;
      const img = await loadImageAsync(url, interpolation);
      if (generation !== this._requestGeneration) return;
      this._setResolved({ kind: 'image', url: img.src, isBlob: ownedUrl !== null, interpolation }, ownedUrl);
    } finally {
      if (ownedUrl && this._blobUrl !== ownedUrl && !this._cleanupTimers.has(ownedUrl)) {
        URL.revokeObjectURL(ownedUrl);
      }
    }
  }

  /**
   * Set the background from a pre-resolved asset URL (e.g. a blob-URL from AssetStore).
   * The caller retains ownership of the URL; no Image() load is performed.
   * Pass `undefined` or `null` to clear the background.
   */
  setBackgroundUrl(
    url: string | undefined | null,
    interpolation: BackgroundInterpolation = 'nearest',
  ): void {
    this._requestGeneration += 1;
    if (!url) {
      this._setResolved(null);
      return;
    }
    const isBlob = url.startsWith('blob:');
    this._setResolved({ kind: 'image', url, isBlob, interpolation });
  }

  destroy(): void {
    this._requestGeneration += 1;
    this._revokePendingBlob();
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private _setResolved(data: BackgroundData, ownedUrl: string | null = null): void {
    const oldBlobUrl = this._blobUrl;
    this._blobUrl = ownedUrl ?? (data?.kind === 'image' && data.url === oldBlobUrl ? oldBlobUrl : null);
    this.setData(data);
    this._scheduleRevoke(oldBlobUrl);
  }

  private _scheduleRevoke(oldUrl: string | null): void {
    if (!oldUrl || oldUrl === this._blobUrl) return;
    if (this._cleanupTimers.has(oldUrl)) return;
    const timer = setTimeout(() => {
      URL.revokeObjectURL(oldUrl);
      this._cleanupTimers.delete(oldUrl);
    }, 200);
    this._cleanupTimers.set(oldUrl, timer);
  }

  private _revokePendingBlob(): void {
    for (const [url, timer] of this._cleanupTimers) {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    }
    this._cleanupTimers.clear();
    if (this._blobUrl) {
      URL.revokeObjectURL(this._blobUrl);
      this._blobUrl = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

export async function loadImageAsync(
  src: string,
  interpolation: BackgroundInterpolation = 'nearest',
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (interpolation === 'nearest') {
      img.style.imageRendering = 'pixelated';
      img.style.setProperty('image-rendering', 'crisp-edges', '');
    } else {
      img.style.imageRendering = 'auto';
    }
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load background image: ${src}`));
    img.src = src;
  });
}

async function parseUint8ArrayBackground(
  data: Uint8Array,
  interpolation: BackgroundInterpolation = 'nearest',
): Promise<string> {
  const format = detectFileFormat(data);
  if (format === 'npy') {
    const parsed = NPYParser.parse(uint8ArrayToArrayBuffer(data));
    const bgImg = createNumpyBackground(parsed, interpolation);
    if (!bgImg) throw new Error('Failed to render NPY background');
    return bgImg.src;
  }
  if (format === 'png' || format === 'jpeg' || format === 'bmp') {
    const blob = new Blob([data as any], { type: `image/${format}` });
    return URL.createObjectURL(blob);
  }
  throw new Error(`Unsupported background format: ${format}`);
}
