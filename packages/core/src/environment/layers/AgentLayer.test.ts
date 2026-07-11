// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
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
});
