import { z } from 'zod';

/**
 * Asset identifiers and metadata are protocol payloads, not renderer cache
 * objects. Renderers may resolve them into blob URLs or local buffers, but the
 * wire contract stays content-addressed by id plus hash.
 */
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
