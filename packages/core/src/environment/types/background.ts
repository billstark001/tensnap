import { z } from 'zod';
import { BaseLayerMetadataSchema } from './layer';

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

export const BackgroundLayerMetadataSchema = BaseLayerMetadataSchema.extend({
  background: BackgroundSourceSchema.optional(),
  interpolation: BackgroundInterpolationSchema.optional(),
}).loose();

export type BackgroundAssetReference = z.infer<typeof BackgroundAssetReferenceSchema>;
export type BackgroundLayerMetadata = z.infer<typeof BackgroundLayerMetadataSchema>;
export type BackgroundSource = z.infer<typeof BackgroundSourceSchema>;

export function isBackgroundAssetReference(value: unknown): value is BackgroundAssetReference {
  return BackgroundAssetReferenceSchema.safeParse(value).success;
}