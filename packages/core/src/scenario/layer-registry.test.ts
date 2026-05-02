import { describe, expect, it } from 'vitest';
import {
  findSceneBounds,
  findViewMetadataSource,
  layerRegistry,
  LayerRegistryClass,
} from './layer-registry';
import { BackgroundLayerMetadataSchema, isBackgroundAssetReference } from '../environment/types';

describe('background layer metadata schema', () => {
  it('rejects dependency_layer_ids in layer metadata', () => {
    const result = layerRegistry.validateMetadata('trajectory', {
      dependency_layer_ids: {
        agent: 'items',
      },
      length: 4,
    });

    expect(result.success).toBe(false);
  });

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

describe('layer registry view helpers', () => {
  const getSceneBounds = (metadata: Record<string, unknown>) => {
    const { width, height } = metadata;
    if (typeof width === 'number' && typeof height === 'number') {
      return { width, height };
    }
    return undefined;
  };

  it('prefers registered scene-bounds and view-metadata priority over layer order', () => {
    const registry = new LayerRegistryClass();
    registry.register({
      layer_type: 'agent',
      view: {
        getSceneBounds,
        sceneBoundsPriority: 10,
      },
    });
    registry.register({
      layer_type: 'grid',
      view: {
        getSceneBounds,
        sceneBoundsPriority: 0,
        viewMetadataPriority: 0,
      },
    });

    const layers = [
      { layerType: 'agent', metadata: { width: 4, height: 5 } },
      { layerType: 'grid', metadata: { width: 10, height: 12 } },
    ];

    expect(findSceneBounds(layers, registry)).toEqual({ width: 10, height: 12 });
    expect(findViewMetadataSource(layers, registry)).toBe(layers[1]);
  });

  it('falls through to the next registered bounds source when the first one has no bounds', () => {
    const registry = new LayerRegistryClass();
    registry.register({
      layer_type: 'grid',
      view: {
        getSceneBounds,
        sceneBoundsPriority: 0,
      },
    });
    registry.register({
      layer_type: 'agent',
      view: {
        getSceneBounds,
        sceneBoundsPriority: 10,
      },
    });

    expect(findSceneBounds([
      { layerType: 'grid', metadata: {} },
      { layerType: 'agent', metadata: { width: 7, height: 9 } },
    ], registry)).toEqual({ width: 7, height: 9 });
  });
});