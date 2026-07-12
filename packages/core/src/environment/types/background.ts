import {
  BackgroundAssetReferenceSchema,
  type BackgroundAssetReference,
} from '@tensnap/protocol/layers';

export function isBackgroundAssetReference(value: unknown): value is BackgroundAssetReference {
  return BackgroundAssetReferenceSchema.safeParse(value).success;
}
