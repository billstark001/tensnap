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

describe('graph geometry ownership and work bounds', () => {
  it('keeps shared edge shapes and force temperature stable for appearance updates', () => {
    const agents = new AgentStorage();
    agents.setAgents([
      { id: 'a', x: 0, y: 0, size: 2 },
      { id: 'b', x: 8, y: 0, size: 2 },
    ]);
    const edges = new EdgeStorage([{ source: 'a', target: 'b' }]);
    const follower = new EdgeLayer(edges, agents, { manualLayout: true });
    const writer = new EdgeLayer(edges, agents, { manualLayout: true });
    const state = (layer: EdgeLayer) =>
      layer as unknown as {
        _simulation: { alpha(): number } | null;
        _edgeShapeMap: Map<string, { line: { points: number[] } }>;
      };
    const key = EdgeStorage.edgeKey('a', 'b');
    try {
      writer.settle(300);
      const alpha = state(writer)._simulation!.alpha();
      const before = state(follower)._edgeShapeMap.get(key);
      agents.updateAgent('a', { color: '#abcdef' });
      expect(state(follower)._edgeShapeMap.get(key)).toBe(before);
      expect(state(writer)._simulation!.alpha()).toBe(alpha);
      writer.setSimConfig({ link_distance: -1 });
      agents.updateAgent('a', { x: 0, y: 0 });
      agents.updateAgent('b', { x: 8, y: 0 });
      agents.updateAgent('a', { size: 4 });
      for (const layer of [follower, writer])
        expect(state(layer)._edgeShapeMap.get(key)!.line.points).toEqual([2, 0, 7, 0]);
    } finally {
      writer.destroy();
      writer.destroy();
      follower.destroy();
      follower.destroy();
    }
  });

  it('never writes or notifies agent storage while rendering readonly edges', () => {
    const agents = new AgentStorage();
    agents.setAgents([
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 4, y: 0 },
    ]);
    const before = agents.dump();
    const revision = agents.revision;
    const notifications = vi.fn();
    agents.subscribe(notifications);
    const edges = new EdgeStorage([{ source: 'a', target: 'b' }]);
    const layer = new EdgeLayer(edges, agents, { readOnlyLayout: true });
    try {
      edges.updateEdge('a', 'b', { color: '#abcdef' });
      expect(agents.dump()).toEqual(before);
      expect(agents.revision).toBe(revision);
      expect(notifications).not.toHaveBeenCalled();
    } finally {
      layer.destroy();
    }
  });

  it('publishes one position update per force tick and synchronizes newly laid out nodes immediately', () => {
    const agents = new AgentStorage();
    agents.setAgents([{ id: 'a' }, { id: 'b' }]);
    const edges = new EdgeStorage([{ source: 'a', target: 'b' }]);
    const layer = new EdgeLayer(edges, agents);
    const internals = layer as unknown as {
      _simulation: { stop(): void };
      _tick(): void;
      _simNodes: Array<{ id: string; x: number; y: number }>;
    };
    internals._simulation.stop();
    const notifications = vi.fn();
    agents.subscribe(notifications);
    try {
      for (const node of internals._simNodes)
        expect(agents.getData().agents.get(node.id)).toMatchObject({ x: node.x, y: node.y });
      internals._tick();
      expect(notifications).toHaveBeenCalledTimes(1);
      agents.addAgent({ id: 'c' });
      internals._simulation.stop();
      const node = internals._simNodes.find((entry) => entry.id === 'c')!;
      expect(agents.getData().agents.get('c')).toMatchObject({ x: node.x, y: node.y });
    } finally {
      layer.destroy();
    }
  });

  it('updates one edge appearance without rewriting unrelated edge geometry', () => {
    const agents = new AgentStorage();
    agents.setAgents(Array.from({ length: 102 }, (_, id) => ({ id, x: id * 2, y: 0 })));
    const edges = new EdgeStorage(
      Array.from({ length: 100 }, (_, source) => ({ source, target: source + 1 })),
    );
    const layer = new EdgeLayer(edges, agents, { readOnlyLayout: true });
    const shapes = (
      layer as unknown as {
        _edgeShapeMap: Map<string, { line: { set(...args: unknown[]): void } }>;
      }
    )._edgeShapeMap;
    const unrelated = vi.spyOn(shapes.get(EdgeStorage.edgeKey(98, 99))!.line, 'set');
    try {
      edges.updateEdge(0, 1, { color: '#abcdef' });
      expect(unrelated).not.toHaveBeenCalled();
    } finally {
      layer.destroy();
    }
  });
});

describe('force layout policy', () => {
  it('permits node dragging only while the shared force writer is enabled', () => {
    const agents = new AgentStorage();
    agents.setAgents([{ id: 'a', x: 1, y: 2 }]);
    const edges = new EdgeStorage();
    const first = new EdgeLayer(edges, agents, { manualLayout: true });
    const drag = first.buildDragHandlers();
    const second = new EdgeLayer(edges, agents, { manualLayout: true, link_distance: -1 });
    try {
      expect(drag.canDrag!()).toBe(false);
      const before = agents.dump();
      drag.onDragStart!('a', 1, 2);
      drag.onDragMove!('a', 10, 20);
      expect(agents.dump()).toEqual(before);
      second.setSimConfig({ link_distance: 0 });
      expect(drag.canDrag!()).toBe(true);
      second.setSimConfig({ link_distance: -1 });
      expect(drag.canDrag!()).toBe(false);
    } finally {
      second.destroy();
      first.destroy();
    }
  });
  it('disables every force for negative distances throughout updates and allows re-enabling at zero', () => {
    const agents = new AgentStorage();
    agents.setAgents([
      { id: 'a', x: 2, y: 3 },
      { id: 'b', x: 2, y: 3 },
    ]);
    const edges = new EdgeStorage([{ source: 'a', target: 'b' }]);
    const layer = new EdgeLayer(edges, agents, { link_distance: -1, manualLayout: true });
    const internal = layer as unknown as { _simulation: { alpha(): number } | null };
    try {
      const before = agents.dump();
      layer.settle(300);
      layer.onViewportChange({ x: 0, y: 0, width: 300, height: 200 }, 'contain');
      edges.updateEdge('a', 'b', { color: '#123456' });
      agents.updateAgent('a', { color: '#abcdef' });
      expect(internal._simulation).toBeNull();
      expect([...agents.getData().agents.values()].map(({ x, y }) => ({ x, y }))).toEqual([
        { x: 2, y: 3 },
        { x: 2, y: 3 },
      ]);
      expect(before.agents).toHaveLength(2);
      layer.setSimConfig({ link_distance: 0 });
      expect(internal._simulation).not.toBeNull();
      layer.settle(20);
      const alpha = internal._simulation!.alpha();
      edges.updateEdge('a', 'b', { color: '#ffffff' });
      expect(internal._simulation!.alpha()).toBe(alpha);
      agents.updateAgent('a', { color: '#112233' });
      expect(internal._simulation!.alpha()).toBe(alpha);
      layer.settle(300);
      agents.updateAgent('a', { x: 123, y: 234 });
      expect(internal._simulation!.alpha()).toBe(0.1);
      layer.setSimConfig({ link_distance: -5 });
      expect(internal._simulation).toBeNull();
      expect(() => layer.setSimConfig({ link_distance: NaN })).toThrow('Invalid graph');
      expect(internal._simulation).toBeNull();
    } finally {
      layer.destroy();
    }
  });

  it('has one writer, combines distinct edge storages and promotes a remaining view on disposal', () => {
    const agents = new AgentStorage();
    agents.setAgents([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const firstEdges = new EdgeStorage([{ source: 'a', target: 'b' }]);
    const first = new EdgeLayer(firstEdges, agents, {
      manualLayout: true,
    });
    const second = new EdgeLayer(new EdgeStorage([{ source: 'b', target: 'c' }]), agents, {
      manualLayout: true,
    });
    const state = (layer: EdgeLayer) =>
      layer as unknown as { _simulation: { alpha(): number } | null; _simLinks: unknown[] };
    try {
      expect(state(first)._simulation).toBeNull();
      expect(state(second)._simLinks).toHaveLength(2);
      const notifications = vi.fn();
      agents.subscribe(notifications);
      second.settle(10);
      expect(notifications).toHaveBeenCalledTimes(1);
      second.settle(300);
      firstEdges.addEdge({ source: 'a', target: 'c' });
      expect(state(second)._simulation!.alpha()).toBe(0.1);
      expect(state(second)._simLinks).toHaveLength(3);
      second.destroy();
      expect(state(first)._simulation).not.toBeNull();
      expect(state(first)._simLinks).toHaveLength(2);
    } finally {
      first.destroy();
    }
  });

  it('uses repeatable bounded layout and respects pins before and after dragging', () => {
    const render = () => {
      const agents = new AgentStorage();
      agents.setAgents([{ id: 1, fx: 7, fy: 8 }, { id: '1' }]);
      const layer = new EdgeLayer(new EdgeStorage([{ source: 1, target: '1' }]), agents, {
        manualLayout: true,
      });
      try {
        layer.settle(50);
        expect(agents.getData().agents.get(1)).toMatchObject({ x: 7, y: 8 });
        const drag = layer.buildDragHandlers();
        drag.onDragEnd!(1);
        expect(agents.getData().agents.get(1)).toMatchObject({ fx: 7, fy: 8 });
        drag.onDragStart!(1, 7, 8);
        drag.onDragMove!(1, 1, 1);
        drag.onDragEnd!(1);
        expect(agents.getData().agents.get(1)).toMatchObject({ fx: 7, fy: 8 });
        return agents.dump();
      } finally {
        layer.destroy();
      }
    };
    expect(render()).toEqual(render());
  });
});
