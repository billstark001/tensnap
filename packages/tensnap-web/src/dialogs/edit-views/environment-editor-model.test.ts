import { describe, expect, it } from 'vitest';
import type { ScenarioEnvironmentState, ScenarioLayerState, ScenarioLayerStorage } from '@tensnap/core/scenario';
import { getEditableEnvironmentData, groupEnvironmentLayerMetadata } from './environment-editor-model';

const stubStorage: ScenarioLayerStorage = {
  dump: () => ({}),
  load: () => {},
};

const createLayer = (
  id: string,
  layerType: string,
  metadata: Record<string, unknown>,
  dependencyLayerIds: Record<string, string> = {},
): ScenarioLayerState => ({
  id,
  layerType,
  metadata,
  dependencyLayerIds,
  storage: stubStorage,
});

describe('environment editor model', () => {
  it('groups trajectory metadata without treating dependencies as metadata', () => {
    const groups = groupEnvironmentLayerMetadata('trajectory', {
      length: 5,
      color: '#0080ff',
      foo: 'bar',
    });

    expect(groups.map((group) => group.title)).toEqual(['Trajectory', 'Other Metadata']);
    expect(groups[0].entries).toEqual([
      { key: 'length', value: 5, editable: true },
      { key: 'color', value: '#0080ff', editable: true },
    ]);
    expect(groups[1].entries).toEqual([{ key: 'foo', value: 'bar', editable: true }]);
  });

  it('separates dependencies from metadata in editable environment data', () => {
    const environments = new Map<string, ScenarioEnvironmentState>([
      ['env-2d', {
        id: 'env-2d',
        type: '2d',
        layers: new Map([
          ['grid', createLayer('grid', 'grid', { width: 10, height: 12 })],
          ['agents', createLayer('agents', 'agent', { coord_offset: 'float' })],
          ['trails', createLayer('trails', 'trajectory', { length: 5 }, { agent: 'agents' })],
        ]),
        dependencyGraph: new Map(),
      }],
      ['env-uniform', {
        id: 'env-uniform',
        type: 'uniform',
        layers: new Map([
          ['agents', createLayer('agents', 'agent', {})],
        ]),
        dependencyGraph: new Map(),
      }],
    ]);

    const env2d = getEditableEnvironmentData(environments, 'env-2d');
    const envUniform = getEditableEnvironmentData(environments, 'env-uniform');

    expect(env2d).toMatchObject({ id: 'env-2d', type: '2d', displayType: '2d' });
    expect(env2d?.layers.map((layer) => layer.id)).toEqual(['grid', 'agents', 'trails']);
    expect(env2d?.layers.find((layer) => layer.id === 'trails')?.groups).toEqual([
      { title: 'Trajectory', entries: [{ key: 'length', value: 5, editable: true }] },
      { title: 'Dependencies', entries: [{ key: 'agent', value: 'agents', editable: false }] },
    ]);
    expect(envUniform).toMatchObject({ id: 'env-uniform', type: 'uniform', displayType: 'uniform' });
    expect(envUniform?.layers).toHaveLength(1);
  });
});
