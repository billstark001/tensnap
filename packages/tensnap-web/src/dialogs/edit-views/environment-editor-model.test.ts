import { describe, expect, it } from 'vitest';
import type { ScenarioEnvironmentState } from '@tensnap/core';
import { getEditableEnvironmentData, groupEnvironmentLayerMetadata } from './environment-editor-model';

describe('environment editor model', () => {
  it('groups 2d layer metadata by semantics', () => {
    const groups = groupEnvironmentLayerMetadata('agent', {
      coord_offset: 'int',
      trajectory_length: 5,
      foo: 'bar',
    });

    expect(groups.map((group) => group.title)).toEqual(['Geometry', 'Trajectory', 'Other Metadata']);
    expect(groups[0].entries).toEqual([{ key: 'coord_offset', value: 'int' }]);
    expect(groups[1].entries).toEqual([{ key: 'trajectory_length', value: 5 }]);
    expect(groups[2].entries).toEqual([{ key: 'foo', value: 'bar' }]);
  });

  it('separates uniform and 2d environment data while preserving per-layer sections', () => {
    const environments = new Map<string, ScenarioEnvironmentState>([
      ['env-2d', {
        id: 'env-2d',
        type: '2d',
        layers: new Map([
          ['grid', { id: 'grid', layerType: 'grid', metadata: { width: 10, height: 12 }, storage: { dump: () => ({}), load: () => {} } }],
          ['agents', { id: 'agents', layerType: 'agent', metadata: { coord_offset: 'float' }, storage: { dump: () => ({}), load: () => {} } }],
        ]),
      }],
      ['env-uniform', {
        id: 'env-uniform',
        type: 'uniform',
        layers: new Map([
          ['agents', { id: 'agents', layerType: 'agent', metadata: {}, storage: { dump: () => ({}), load: () => {} } }],
        ]),
      }],
    ]);

    const env2d = getEditableEnvironmentData(environments, 'env-2d');
    const envUniform = getEditableEnvironmentData(environments, 'env-uniform');

    expect(env2d).toMatchObject({ id: 'env-2d', type: '2d', displayType: '2d' });
    expect(env2d?.layers.map((layer) => layer.id)).toEqual(['grid', 'agents']);
    expect(envUniform).toMatchObject({ id: 'env-uniform', type: 'uniform', displayType: 'uniform' });
    expect(envUniform?.layers).toHaveLength(1);
  });
});