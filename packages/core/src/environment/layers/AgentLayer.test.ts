// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { AgentStorage } from '../storages/AgentStorage';
import { AgentLayer } from './AgentLayer';

type AgentEntry = {
  group: Record<string, unknown>;
  shape: Record<string, unknown>;
  highlight: Record<string, unknown> | null;
  color: string;
};

function getEntry(layer: AgentLayer, id: string): AgentEntry {
  const entries = (layer as unknown as { _agentShapes: Map<string, AgentEntry> })._agentShapes;
  return entries.get(id)!;
}

function getLeaferProperty(target: Record<string, unknown>, name: string): unknown {
  return target[name] ?? (target.__ as Record<string, unknown> | undefined)?.[name];
}

describe('AgentLayer inspection highlight', () => {
  it('uses a separate circular outline for an inspected custom icon', () => {
    const agents = new AgentStorage();
    agents.setAgents([{ id: 'asset-agent', icon: 'asset:portrait', color: '#445566', size: 12 }]);
    const layer = new AgentLayer(agents, { highlightedAgentId: 'asset-agent' });

    const entry = getEntry(layer, 'asset-agent');
    expect(entry.highlight).not.toBeNull();
    expect(getLeaferProperty(entry.highlight!, 'fill')).toBe('#facc15');
    expect(getLeaferProperty(entry.highlight!, 'innerRadius')).toBe(0.82);
    expect(getLeaferProperty(entry.shape, 'stroke')).not.toBe('#facc15');
    expect(getLeaferProperty(entry.group, 'zIndex')).toBe(1_000);
    layer.destroy();
  });

  it('keeps the outline while an inspected agent changes color', () => {
    const agents = new AgentStorage();
    agents.setAgents([{ id: 'selected', icon: 'circle', color: '#112233', size: 8 }]);
    const layer = new AgentLayer(agents, { highlightedAgentId: 'selected' });
    const entry = getEntry(layer, 'selected');
    const highlight = entry.highlight;

    agents.updateAgent('selected', { color: '#abcdef' });

    expect(entry.highlight).toBe(highlight);
    expect(entry.color).toBe('#abcdef');
    expect(getLeaferProperty(entry.shape, 'fill')).toBe('#abcdef');
    expect(getLeaferProperty(entry.group, 'zIndex')).toBe(1_000);
    layer.destroy();
  });

  it('uses a finite positive marker size when an agent advertises an invalid diameter', () => {
    const agents = new AgentStorage();
    agents.setAgents([{ id: 'invalid-size', x: 2, y: 3, size: -4 }]);
    const layer = new AgentLayer(agents);
    const entry = getEntry(layer, 'invalid-size') as AgentEntry & { size: number };
    expect(entry.size).toBe(1);
    expect(layer.getSceneBounds()).toEqual(expect.objectContaining({ minX: expect.any(Number), maxX: expect.any(Number) }));
    layer.destroy();
  });
});

describe('AgentLayer incremental updates', () => {
  it('skips Leafer writes when an update leaves appearance and position unchanged', () => {
    const agents = new AgentStorage();
    agents.setAgents([{ id: 'a', x: 1, y: 2, size: 1, color: '#123456' }]);
    const layer = new AgentLayer(agents);
    const entry = getEntry(layer, 'a');
    const groupSet = vi.spyOn(entry.group as { set: (...args: unknown[]) => unknown }, 'set');
    const shapeSet = vi.spyOn(entry.shape as { set: (...args: unknown[]) => unknown }, 'set');

    agents.updateAgent('a', { x: 1, y: 2 });
    expect(groupSet).not.toHaveBeenCalled();
    expect(shapeSet).not.toHaveBeenCalled();

    agents.updateAgent('a', { x: 3 });
    expect(groupSet).toHaveBeenCalledTimes(1);
    expect(shapeSet).not.toHaveBeenCalled();
    expect(getLeaferProperty(entry.group, 'x')).toBe(3.5);

    groupSet.mockClear();
    agents.updateAgent('a', { color: '#654321' });
    expect(groupSet).not.toHaveBeenCalled();
    expect(shapeSet).toHaveBeenCalledTimes(1);

    shapeSet.mockClear();
    agents.updateAgent('a', { size: 0.6 });
    expect(groupSet).not.toHaveBeenCalled();
    expect(shapeSet).toHaveBeenCalledTimes(1);

    layer.destroy();
  });

  it('updates labels only when their size changes', () => {
    const agents = new AgentStorage();
    agents.setAgents([{ id: 'a', x: 1, y: 2, size: 1 }]);
    const layer = new AgentLayer(agents, { showLabel: true });
    const entry = getEntry(layer, 'a') as AgentEntry & { label: { set: (...args: unknown[]) => unknown } };
    const labelSet = vi.spyOn(entry.label, 'set');

    agents.updateAgent('a', { x: 4 });
    expect(labelSet).not.toHaveBeenCalled();
    agents.updateAgent('a', { size: 2 });
    expect(labelSet).toHaveBeenCalledTimes(1);
    layer.destroy();
  });
});
