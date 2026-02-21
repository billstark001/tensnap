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

// ---------------------------------------------------------------------------
// Data type
// ---------------------------------------------------------------------------

/** Image interpolation mode: 'nearest' = pixelated, 'linear' = smooth. */
export type ImageInterpolation = 'nearest' | 'linear';

export type BackgroundValue =
  | { kind: 'color'; value: string }
  | { kind: 'image'; url: string; isBlob: boolean; interpolation: ImageInterpolation };

export type BackgroundData = BackgroundValue | null;

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export class BackgroundStorage extends BaseStorage<BackgroundData> {
  /** Currently active blob URL (if any) — kept so we can revoke it. */
  private _blobUrl: string | null = null;
  private _cleanupTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super(null);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Accept raw background input, resolve it asynchronously, and notify.
   * The caller does not need to await — resolution happens in the background.
   * @param interpolation Image interpolation mode. Defaults to 'nearest'.
   */
  async setBackground(
    background: string | Uint8Array | undefined,
    interpolation: ImageInterpolation = 'nearest',
  ): Promise<void> {
    if (background === undefined || background === null) {
      this._setResolved(null);
      return;
    }

    if (typeof background === 'string') {
      if (isCssColor(background)) {
        this._setResolved({ kind: 'color', value: background });
      } else {
        // Image URL — resolve via Image() to confirm it loads.
        const img = await loadImageAsync(background, interpolation);
        this._setResolved({ kind: 'image', url: img.src, isBlob: false, interpolation });
      }
      return;
    }

    // Uint8Array — detect format and decode
    const url = await parseUint8ArrayBackground(background, interpolation);
    const img = await loadImageAsync(url, interpolation);
    this._setResolved({ kind: 'image', url: img.src, isBlob: url.startsWith('blob:'), interpolation });
  }

  destroy(): void {
    this._revokePendingBlob();
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private _setResolved(data: BackgroundData): void {
    const oldBlobUrl = this._blobUrl;
    this._blobUrl =
      data?.kind === 'image' && data.isBlob ? data.url : null;
    this.setData(data);
    this._scheduleRevoke(oldBlobUrl);
  }

  private _scheduleRevoke(oldUrl: string | null): void {
    if (!oldUrl || oldUrl === this._blobUrl) return;
    if (this._cleanupTimer !== null) clearTimeout(this._cleanupTimer);
    this._cleanupTimer = setTimeout(() => {
      URL.revokeObjectURL(oldUrl);
      this._cleanupTimer = null;
    }, 200);
  }

  private _revokePendingBlob(): void {
    if (this._cleanupTimer !== null) {
      clearTimeout(this._cleanupTimer);
      this._cleanupTimer = null;
    }
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
  interpolation: ImageInterpolation = 'nearest',
): Promise<HTMLImageElement> {
  return new Promise((resolve) => {
    const img = new Image();
    if (interpolation === 'nearest') {
      img.style.imageRendering = 'pixelated';
      img.style.setProperty('image-rendering', 'crisp-edges', '');
    } else {
      img.style.imageRendering = 'auto';
    }
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.src = src;
  });
}

async function parseUint8ArrayBackground(
  data: Uint8Array,
  interpolation: ImageInterpolation = 'nearest',
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
