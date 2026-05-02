import { z } from 'zod';

export const AssetIdSchema = z.string();

export type AssetId = z.infer<typeof AssetIdSchema>;

export const AssetMetaSchema = z.object({
  id: AssetIdSchema,
  hash: z.string(),
  mime: z.string(),
  size: z.number(),
  label: z.string().optional(),
});

export type AssetMeta = z.infer<typeof AssetMetaSchema>;

export interface ResolvedAsset extends AssetMeta {
  url: string | Uint8Array;
}

export type AssetStoreListener = (id: AssetId, asset: ResolvedAsset | null) => void;