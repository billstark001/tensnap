import { describe, expect, it } from 'vitest';
import { presentEnvironmentSnapshot, resolvePresentationMetadata } from './presentation';
import { createRenderPlanFromSnapshot } from './utils/plan';
import type { LayerPresentationOverride } from './presentation';
import type { ScenarioEnvironmentSnapshot } from './types';

describe('local layer presentation', () => {
  it('retains zero target length and accepts a negative layout switch without changing source data', () => {
    const metadata = { link_distance: 0, custom: 'simulator-owned' };
    expect(resolvePresentationMetadata('edge', metadata)).toBe(metadata);
    expect(resolvePresentationMetadata('edge', metadata, { link_distance: -1 })).toEqual({
      ...metadata,
      link_distance: -1,
    });
    expect(metadata.link_distance).toBe(0);
  });

  it.each<LayerPresentationOverride>([
    { collision_radius: -1 },
    { link_distance: Infinity },
    { hidden: true },
    { link_distance: '4' },
  ])('rejects ineffective or invalid settings: %j', (override) => {
    expect(() => resolvePresentationMetadata('edge', {}, override)).toThrow(
      'Invalid edge presentation',
    );
  });

  it('carries storage-backed presentation into the shared snapshot render plan without copying data', () => {
    const environment: ScenarioEnvironmentSnapshot = {
      id: 'world',
      type: '2d',
      layers: [
        {
          id: 'grid',
          layerType: 'grid',
          metadata: {},
          dependencyLayerIds: {},
          storageSnapshot: {},
        },
      ],
    };
    const presented = presentEnvironmentSnapshot(environment, {
      grid: { stroke_color: '#123456' },
    });
    expect(presented.layers[0]!.storageSnapshot).toBe(environment.layers[0]!.storageSnapshot);
    expect(environment.layers[0]!.metadata).toEqual({});
    expect(createRenderPlanFromSnapshot(presented).layers[0]).toMatchObject({
      presentation: { stroke_color: '#123456' },
    });
    expect(() => presentEnvironmentSnapshot(environment, { missing: {} })).toThrow(
      'does not exist',
    );
  });
});
