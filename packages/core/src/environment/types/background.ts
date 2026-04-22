import { z } from 'zod';
import type { ImageInterpolation } from '../storages/BackgroundStorage';

export const BackgroundInterpolationSchema = z.enum(['nearest', 'linear']);

export const BackgroundAssetReferenceSchema = z.object({
  asset_id: z.string(),
  interpolation: BackgroundInterpolationSchema.optional(),
});

export const BackgroundSourceSchema = z.union([
  z.string(),
  z.instanceof(Uint8Array),
  BackgroundAssetReferenceSchema,
]);

export interface BackgroundLayerMetadata {
  background?: BackgroundSource;
  interpolation?: ImageInterpolation;
}

export type BackgroundAssetReference = z.infer<typeof BackgroundAssetReferenceSchema>;
export type BackgroundSource = z.infer<typeof BackgroundSourceSchema>;

export function isBackgroundAssetReference(value: unknown): value is BackgroundAssetReference {
  return BackgroundAssetReferenceSchema.safeParse(value).success;
}