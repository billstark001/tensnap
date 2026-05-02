/**
 * asset/AssetStore.ts
 *
 * Framework-agnostic, project-level asset cache.
 *
 * Assets are binary or text resources (images, SVGs, numpy arrays, …) that
 * are reused across multiple environments / layers.  The server announces
 * assets with metadata (id, hash, mime, size) before sending the actual data.
 * The client deduplicates by (id, hash) so unchanged assets are not re-fetched.
 *
 * Lifecycle:
 *   1. Server sends `asset_meta` → store records metadata + marks as pending.
 *   2. Store emits the pending ids via `onNeedData` callback.
 *   3. Caller sends `asset_sync` with its current (id → hash) map.
 *   4. Server sends `asset_data` for missing / outdated assets.
 *   5. Store creates an object-URL (for images) or stores raw data, then notifies
 *      subscribers of the resolved asset.
 *   6. Server sends `asset_delete` → store revokes blob URLs and removes entries.
 */

import { decodeBinaryString } from '../utils/binary';
import type { AssetId, AssetMeta, AssetStoreListener, ResolvedAsset } from './types';

// ---------------------------------------------------------------------------
// AssetStore
// ---------------------------------------------------------------------------

export class AssetStore {
  /** Known metadata (including assets whose data hasn't arrived yet). */
  private readonly _meta = new Map<AssetId, AssetMeta>();
  /** Fully resolved assets (data present). */
  private readonly _resolved = new Map<AssetId, ResolvedAsset>();
  /** Active blob-URLs to revoke on removal. */
  private readonly _blobUrls = new Map<AssetId, string>();
  /** Listeners notified on any change. */
  private readonly _listeners = new Set<AssetStoreListener>();

  // -------------------------------------------------------------------------
  // Subscription
  // -------------------------------------------------------------------------

  subscribe(listener: AssetStoreListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  private _notify(id: AssetId, asset: ResolvedAsset | null) {
    for (const l of this._listeners) l(id, asset);
  }

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  /**
   * Record asset metadata.  If the asset was previously resolved with the same
   * hash we keep the existing resolved data.  If the hash differs the old
   * resolved entry is invalidated so callers will re-request.
   *
   * @returns true if new data is needed (asset is missing or hash changed)
   */
  receiveMeta(meta: AssetMeta): boolean {
    const existing = this._resolved.get(meta.id);
    if (existing?.hash === meta.hash) {
      // Already up-to-date — just refresh metadata label etc.
      this._meta.set(meta.id, meta);
      return false;
    }
    // Invalidate stale resolved entry
    if (existing) {
      this._revokeBlobUrl(meta.id);
      this._resolved.delete(meta.id);
    }
    this._meta.set(meta.id, meta);
    return true;
  }

  /** Receive a batch of metadata and return the ids that need data. */
  receiveMetaBatch(metas: AssetMeta[]): AssetId[] {
    return metas.filter((m) => this.receiveMeta(m)).map((m) => m.id);
  }

  getMeta(id: AssetId): AssetMeta | undefined {
    return this._meta.get(id);
  }

  listMeta(): AssetMeta[] {
    return [...this._meta.values()];
  }

  /** Map of id → currently-held hash for all *resolved* assets (for asset_sync). */
  getHeldHashes(): Record<AssetId, string> {
    const result: Record<AssetId, string> = {};
    for (const [id, asset] of this._resolved) {
      result[id] = asset.hash;
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Data
  // -------------------------------------------------------------------------

  /**
   * Receive raw asset data from the server and resolve it.
   * For image/* mime types a blob-URL is created.
   * For text/* types the data is decoded to a string.
   * String inputs may be either bare base64 or explicit base64 data URLs.
   * For all other types the raw Uint8Array is stored.
   */
  async receiveData(id: AssetId, hash: string, mime: string, raw: string | Uint8Array): Promise<void> {
    // Decode JSON-side base64/data-URL strings into bytes before resolving by mime.
    const bytes: Uint8Array =
      typeof raw === 'string' ? decodeBinaryString(raw).bytes : raw;

    let url: string | Uint8Array;

    if (mime.startsWith('image/') || mime === 'application/octet-stream') {
      const oldUrl = this._blobUrls.get(id);
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const blob = new Blob([buf as ArrayBuffer], { type: mime });
      const blobUrl = URL.createObjectURL(blob);
      this._blobUrls.set(id, blobUrl);
      url = blobUrl;
    } else if (mime.startsWith('text/') || mime === 'application/json' || mime === 'image/svg+xml') {
      url = new TextDecoder().decode(bytes);
    } else {
      url = bytes;
    }

    // Update or create metadata if we didn't receive asset_meta first
    const meta: AssetMeta = this._meta.get(id) ?? { id, hash, mime, size: bytes.byteLength };
    meta.hash = hash;
    meta.mime = mime;
    this._meta.set(id, meta);

    const resolved: ResolvedAsset = { ...meta, url };
    this._resolved.set(id, resolved);
    this._notify(id, resolved);
  }

  // -------------------------------------------------------------------------
  // Deletion
  // -------------------------------------------------------------------------

  delete(id: AssetId): void {
    this._revokeBlobUrl(id);
    this._resolved.delete(id);
    this._meta.delete(id);
    this._notify(id, null);
  }

  deleteBatch(ids: AssetId[]): void {
    for (const id of ids) this.delete(id);
  }

  clear(): void {
    this.deleteBatch([...this._meta.keys()]);
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  get(id: AssetId): ResolvedAsset | undefined {
    return this._resolved.get(id);
  }

  getUrl(id: AssetId): string | undefined {
    const r = this._resolved.get(id);
    if (!r) return undefined;
    return typeof r.url === 'string' ? r.url : undefined;
  }

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  destroy(): void {
    this.clear();
    this._listeners.clear();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _revokeBlobUrl(id: AssetId): void {
    const url = this._blobUrls.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      this._blobUrls.delete(id);
    }
  }
}
