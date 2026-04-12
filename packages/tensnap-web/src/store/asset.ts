/**
 * store/asset.ts
 *
 * Project-level Zustand store for the asset cache.
 *
 * There is one AssetStore per project (not per scenario). The store wraps the
 * core AssetStore with a Zustand reactive layer so React components can
 * subscribe to asset changes.
 *
 * Usage inside a project context:
 *   const url = useAssetStore(s => s.getUrl('my-asset-id'));
 */

import { create, StoreApi, UseBoundStore } from 'zustand';
import { AssetStore, AssetId, AssetMeta, ResolvedAsset } from '@tensnap/core';

// ---------------------------------------------------------------------------
// Store type
// ---------------------------------------------------------------------------

export interface AssetStoreState {
  /** Core (non-reactive) asset cache. */
  _core: AssetStore;

  /**
   * Monotonic counter bumped whenever any asset changes.
   * Components that want to react to any asset change can subscribe to this.
   */
  _revision: number;

  // ---- Actions ----

  /** Process an `asset_meta` payload. Returns ids that need data. */
  receiveMeta: (metas: AssetMeta[]) => AssetId[];

  /** Process an `asset_data` payload (async — creates blob URL for images). */
  receiveData: (id: AssetId, hash: string, mime: string, raw: string | Uint8Array) => Promise<void>;

  /** Process an `asset_delete` payload. */
  deleteAssets: (ids: AssetId[]) => void;

  /** Get a resolved asset. */
  get: (id: AssetId) => ResolvedAsset | undefined;

  /** Get a URL string for an image asset, or undefined if not yet resolved. */
  getUrl: (id: AssetId) => string | undefined;

  /** Map of id → hash for all currently held assets (for asset_sync). */
  getHeldHashes: () => Record<AssetId, string>;
}

// ---------------------------------------------------------------------------
// Factory — one store per project instance
// ---------------------------------------------------------------------------

export function createAssetStore(): UseBoundStore<StoreApi<AssetStoreState>> {
  const core = new AssetStore();

  return create<AssetStoreState>((set, get) => {
    // Subscribe to core store to bump revision on any change
    core.subscribe(() => {
      set((s) => ({ _revision: s._revision + 1 }));
    });

    return {
      _core: core,
      _revision: 0,

      receiveMeta: (metas) => {
        return get()._core.receiveMetaBatch(metas);
      },

      receiveData: async (id, hash, mime, raw) => {
        await get()._core.receiveData(id, hash, mime, raw);
        // _revision bump happens via the core subscriber above
      },

      deleteAssets: (ids) => {
        get()._core.deleteBatch(ids);
        // _revision bump happens via the core subscriber above
      },

      get: (id) => get()._core.get(id),

      getUrl: (id) => get()._core.getUrl(id),

      getHeldHashes: () => get()._core.getHeldHashes(),
    };
  });
}

export type UseAssetStore = UseBoundStore<StoreApi<AssetStoreState>>;
