import { describe, expect, it } from 'vitest';
import { defineEnvironment } from '../bindings/define';
import { buildScenarioDefinition } from '../bindings/definition';
import { sameDependencyLayerIds } from './layerTopology';

describe('layer binding topology', () => {
  it('orders prerequisites before dependents and rejects invalid graphs', () => {
    const environment = defineEnvironment({
      id: 'main',
      type: '2d' as const,
      layers: [
        { layerId: 'edges', layerType: 'edge', dependencyLayerIds: { agent: 'agents' } },
        { layerId: 'agents', layerType: 'agent' },
      ],
    });
    expect(environment.layers.map((layer) => layer.layerId)).toEqual(['agents', 'edges']);
    expect(() =>
      defineEnvironment({
        id: 'main',
        type: '2d' as const,
        layers: [{ layerId: 'edges', layerType: 'edge', dependencyLayerIds: { agent: 'missing' } }],
      }),
    ).toThrow(/missing layer/);
    expect(() =>
      defineEnvironment({
        id: 'main',
        type: '2d' as const,
        layers: [
          { layerId: 'a', layerType: 'agent', dependencyLayerIds: { other: 'b' } },
          { layerId: 'b', layerType: 'edge', dependencyLayerIds: { agent: 'a' } },
        ],
      }),
    ).toThrow(/Cyclic layer dependency/);
    expect(() =>
      defineEnvironment({
        id: 'main',
        type: '2d' as const,
        layers: [
          { layerId: 'edges', layerType: 'edge', dependencyLayerIds: { agent: 'agents' } },
          { layerId: 'agents', layerType: 'grid' },
        ],
      }),
    ).toThrow(/requires agent layer/);
    expect(() =>
      defineEnvironment({
        id: 'main',
        type: '2d' as const,
        layers: [
          { layerId: 'same', layerType: 'grid' },
          { layerId: 'same', layerType: 'grid' },
        ],
      }),
    ).toThrow(/duplicate layer id/);
  });

  it('compiles binding topology once while rebuilding dynamic metadata', () => {
    let reads = 0;
    const edge = {
      id: 'edges',
      type: 'edge',
      get dependencyLayerIds() {
        reads += 1;
        return { agent: 'agents' };
      },
    };
    const binding = {
      parameters: [],
      actions: [],
      charts: [],
      monitors: [],
      lifecycleLabels: {},
      options: {},
      environments: [{ id: 'main', type: '2d', layers: [edge, { id: 'agents', type: 'agent' }] }],
    } as unknown as Parameters<typeof buildScenarioDefinition>[0];
    const first = buildScenarioDefinition(binding, {}, {});
    const second = buildScenarioDefinition(binding, {}, {});
    expect(first.environments?.[0]?.layers?.map((layer) => layer.layerId)).toEqual([
      'agents',
      'edges',
    ]);
    expect(second.environments?.[0]?.layers?.map((layer) => layer.layerId)).toEqual([
      'agents',
      'edges',
    ]);
    expect(reads).toBe(1);
  });

  it('keeps declaration order among sibling prerequisites', () => {
    const environment = defineEnvironment({
      id: 'main',
      type: '2d' as const,
      layers: [
        {
          layerId: 'dependent',
          layerType: 'grid',
          dependencyLayerIds: { first: 'first', second: 'second' },
        },
        { layerId: 'second', layerType: 'grid' },
        { layerId: 'first', layerType: 'grid' },
      ],
    });
    expect(environment.layers.map((layer) => layer.layerId)).toEqual([
      'second',
      'first',
      'dependent',
    ]);
  });

  it('compares dependency roles independent of object key order', () => {
    expect(
      sameDependencyLayerIds(
        { agent: 'agents', other: 'grid' },
        { other: 'grid', agent: 'agents' },
      ),
    ).toBe(true);
    expect(sameDependencyLayerIds({ agent: 'agents' }, { agent: 'different' })).toBe(false);
  });
});
