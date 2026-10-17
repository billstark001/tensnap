// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { AgentStorage } from '../storages/AgentStorage';
import { EdgeStorage } from '../storages/EdgeStorage';
import { EdgeLayer } from './EdgeLayer';

describe('EdgeLayer incremental updates', () => {
  it('replaces one edge shape when its visual attributes change', () => {
    const agents = new AgentStorage();
    agents.setAgents([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 2, y: 0 },
    ]);
    const edges = new EdgeStorage([{ source: 'a', target: 'b', color: '#111111' }]);
    const layer = new EdgeLayer(edges, agents, { readOnlyLayout: true });
    const shapes = (
      layer as unknown as {
        _edgeShapeMap: Map<string, { line: { stroke: string }; arrowhead: unknown }>;
      }
    )._edgeShapeMap;
    const key = EdgeStorage.edgeKey('a', 'b');
    const before = shapes.get(key);
    const links = (
      layer as unknown as { _simLinkMap: Map<string, { source: unknown; target: unknown }> }
    )._simLinkMap;
    const source = links.get(key)?.source;
    const target = links.get(key)?.target;
    const syncLinks = vi.spyOn(layer as unknown as { _syncLinkForce(): void }, '_syncLinkForce');

    edges.updateEdge('a', 'b', { color: '#abcdef', directed: true });

    expect(shapes.size).toBe(1);
    expect(shapes.get(key)).not.toBe(before);
    expect(shapes.get(key)?.line.stroke).toBe('#abcdef');
    expect(shapes.get(key)?.arrowhead).not.toBeNull();
    expect(links.get(key)?.source).toBe(source);
    expect(links.get(key)?.target).toBe(target);
    expect(syncLinks).not.toHaveBeenCalled();
    layer.destroy();
  });
});

it.each([true, false])(
  'projects typed graph endpoints from fixed coordinates (readonly=%s)',
  (readOnlyLayout) => {
    const agents = new AgentStorage();
    const input = [
      { id: 1, x: -4, y: 2, size: 2 },
      { id: '1', x: 4, y: 2, size: 2 },
    ];
    agents.setAgents(structuredClone(input));
    const edges = new EdgeStorage([{ source: 1, target: '1', directed: true }]);
    const layer = new EdgeLayer(edges, agents, { readOnlyLayout });
    const internals = layer as unknown as {
      _simulation: { stop(): void } | null;
      _edgeShapeMap: Map<string, { line: { points: number[] } }>;
    };
    internals._simulation?.stop();
    const key = EdgeStorage.edgeKey(1, '1');
    expect(internals._edgeShapeMap.get(key)?.line.points).toEqual([-3, 2, 3, 2]);
    if (readOnlyLayout) {
      expect(internals._simulation).toBeNull();
      expect([...agents.getData().agents.values()]).toMatchObject(input);
      edges.updateEdge(1, '1', { color: '#123456' });
      expect(internals._edgeShapeMap.get(key)?.line.points).toEqual([-3, 2, 3, 2]);
      agents.setAgents([
        { ...input[0]!, y: 5 },
        { ...input[1]!, y: 5 },
      ]);
      expect(internals._edgeShapeMap.get(key)?.line.points).toEqual([-3, 5, 3, 5]);
    }
    layer.destroy();
  },
);
