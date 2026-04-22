import { describe, expect, it } from 'vitest';
import {
  BackgroundLayerMetadataSchema,
  layerRegistry,
} from './layer-registry';
import { isBackgroundAssetReference } from '../environment/types';

describe('background layer metadata schema', () => {
  it('accepts explicit asset references and interpolation settings', () => {
    expect(() => {
      BackgroundLayerMetadataSchema.parse({
        background: {
          asset_id: 'asset-1',
          interpolation: 'nearest',
        },
        interpolation: 'linear',
      });
    }).not.toThrow();
  });

  it('rejects opaque background objects', () => {
    expect(() => {
      layerRegistry.validateMetadata('background', {
        background: {
          foo: 'bar',
        },
      });
    }).not.toThrow();

    const result = layerRegistry.validateMetadata('background', {
      background: {
        foo: 'bar',
      },
    });

    expect(result.success).toBe(false);
  });

  it('recognizes only declared asset reference objects', () => {
    expect(isBackgroundAssetReference({ asset_id: 'asset-1' })).toBe(true);
    expect(isBackgroundAssetReference({ asset_id: 'asset-1', interpolation: 'linear' })).toBe(true);
    expect(isBackgroundAssetReference({ asset_id: 'asset-1', interpolation: 'cubic' })).toBe(false);
    expect(isBackgroundAssetReference({ foo: 'bar' })).toBe(false);
  });
});