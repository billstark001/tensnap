import type { AssetId, AssetMeta } from '@tensnap/protocol';

export interface ResolvedAsset extends AssetMeta {
  /** Browser/display-safe image URL, text payload, or raw bytes. */
  url: string | Uint8Array;
  /** Original render source for headless consumers that cannot resolve blob URLs. */
  source?: string | Uint8Array;
}

/** Serializable asset payload retained by projects and offline recordings. */
export interface AssetSnapshot {
  meta: AssetMeta;
  data?: string | Uint8Array;
}

export type AssetStoreListener = (id: AssetId, asset: ResolvedAsset | null) => void;
