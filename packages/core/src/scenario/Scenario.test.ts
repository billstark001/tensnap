import { describe, it, expect, vi } from 'vitest';
import { Scenario } from './Scenario';
import { AgentStorage } from '../environment/storages/AgentStorage';
import { EdgeStorage } from '../environment/storages/EdgeStorage';

// ── Helpers ───────────────────────────────────────────────────────────────────

function msg(type: string, payload: unknown) {
  return { type, payload } as any;
}

function setupEnvAndAgentLayer(s: Scenario, envId = 'env1', layerId = 'layer1') {
  s.apply(msg('env_create', { id: envId, type: '2d' }));
  s.apply(msg('env_layer_create', { env_id: envId, layer_id: layerId, layer_type: 'agent' }));
}

function setupEnvAndEdgeLayer(s: Scenario, envId = 'env1', edgeLayerId = 'edges', agentLayerId = 'agents') {
  s.apply(msg('env_create', { id: envId, type: '2d' }));
  s.apply(msg('env_layer_create', { env_id: envId, layer_id: agentLayerId, layer_type: 'agent' }));
  s.apply(msg('env_layer_create', { env_id: envId, layer_id: edgeLayerId, layer_type: 'edge', data: { agent_layer_id: agentLayerId } }));
}

// ── Environment / Layer lifecycle ─────────────────────────────────────────────

describe('Scenario – environment and layer lifecycle', () => {
  it('env_create registers a new environment', () => {
    const s = new Scenario();
    s.apply(msg('env_create', { id: 'env1', type: '2d' }));
    expect(s.environments.has('env1')).toBe(true);
  });

  it('env_layer_create registers a layer in the environment', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    const env = s.environments.get('env1')!;
    expect(env.layers.has('layer1')).toBe(true);
    expect(env.layers.get('layer1')!.layerType).toBe('agent');
  });

  it('env_layer_create for agent type creates AgentStorage', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    const layer = s.environments.get('env1')!.layers.get('layer1')!;
    expect(layer.storage).toBeInstanceOf(AgentStorage);
  });

  it('env_layer_create for edge type creates EdgeStorage', () => {
    const s = new Scenario();
    setupEnvAndEdgeLayer(s);
    const layer = s.environments.get('env1')!.layers.get('edges')!;
    expect(layer.storage).toBeInstanceOf(EdgeStorage);
  });

  it('env_layer_delete removes the layer', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    s.apply(msg('env_layer_delete', { env_id: 'env1', layer_id: 'layer1' }));
    expect(s.environments.get('env1')!.layers.has('layer1')).toBe(false);
  });

  it('env_delete removes the environment', () => {
    const s = new Scenario();
    s.apply(msg('env_create', { id: 'env1', type: '2d' }));
    s.apply(msg('env_delete', { id: 'env1' }));
    expect(s.environments.has('env1')).toBe(false);
  });
});

// ── Agent CRUD ────────────────────────────────────────────────────────────────

describe('Scenario – agent_create / agent_update / agent_delete', () => {
  it('agent_create populates AgentStorage', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    s.apply(msg('agent_create', {
      env_id: 'env1', layer_id: 'layer1',
      agents: [{ id: 'a1', x: 10, y: 20 }, { id: 'a2', x: 30, y: 40 }],
    }));
    const storage = s.environments.get('env1')!.layers.get('layer1')!.storage as AgentStorage;
    expect(storage.getData().agents.size).toBe(2);
    expect(storage.getData().agents.get('a1')).toMatchObject({ x: 10, y: 20 });
  });

  it('agent_update changes agent fields', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    s.apply(msg('agent_create', { env_id: 'env1', layer_id: 'layer1', agents: [{ id: 'a1', x: 0 }] }));
    s.apply(msg('agent_update', { env_id: 'env1', layer_id: 'layer1', agents: [{ id: 'a1', x: 99 }] }));
    const storage = s.environments.get('env1')!.layers.get('layer1')!.storage as AgentStorage;
    expect(storage.getData().agents.get('a1')?.x).toBe(99);
  });

  it('agent_delete removes the agent', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    s.apply(msg('agent_create', { env_id: 'env1', layer_id: 'layer1', agents: [{ id: 'a1' }, { id: 'a2' }] }));
    s.apply(msg('agent_delete', { env_id: 'env1', layer_id: 'layer1', ids: ['a1'] }));
    const storage = s.environments.get('env1')!.layers.get('layer1')!.storage as AgentStorage;
    expect(storage.getData().agents.has('a1')).toBe(false);
    expect(storage.getData().agents.has('a2')).toBe(true);
  });

  it('agent_create emits agent:create event', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    const listener = vi.fn();
    s.addEventListener('agent:create', listener);
    s.apply(msg('agent_create', { env_id: 'env1', layer_id: 'layer1', agents: [{ id: 'a1' }] }));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ── Edge CRUD ─────────────────────────────────────────────────────────────────

describe('Scenario – edge_create / edge_update / edge_delete', () => {
  it('edge_create populates EdgeStorage', () => {
    const s = new Scenario();
    setupEnvAndEdgeLayer(s);
    s.apply(msg('edge_create', {
      env_id: 'env1', layer_id: 'edges',
      edges: [{ source: 'a', target: 'b' }],
    }));
    const storage = s.environments.get('env1')!.layers.get('edges')!.storage as EdgeStorage;
    expect(storage.getEdgeCount()).toBe(1);
    expect(storage.findEdge('a', 'b')).toBeDefined();
  });

  it('edge_delete removes edges by source/target pairs', () => {
    const s = new Scenario();
    setupEnvAndEdgeLayer(s);
    s.apply(msg('edge_create', { env_id: 'env1', layer_id: 'edges', edges: [{ source: 'a', target: 'b' }, { source: 'c', target: 'd' }] }));
    s.apply(msg('edge_delete', { env_id: 'env1', layer_id: 'edges', edges: [{ source: 'a', target: 'b' }] }));
    const storage = s.environments.get('env1')!.layers.get('edges')!.storage as EdgeStorage;
    expect(storage.getEdgeCount()).toBe(1);
    expect(storage.findEdge('c', 'd')).toBeDefined();
  });
});

// ── Parameter handling ────────────────────────────────────────────────────────

describe('Scenario – param_create with sanitization', () => {
  it('stores parameter after param_create', () => {
    const s = new Scenario();
    s.apply(msg('param_create', { id: 'p1', type: 'number', label: 'P1', value: 5, min: 0, max: 10, step: 1 }));
    expect(s.parameters.has('p1')).toBe(true);
  });

  it('sanitizes number parameter range (fills sensible step when 0)', () => {
    const s = new Scenario();
    // value=5, no min/max/step provided — range should be estimated
    s.apply(msg('param_create', { id: 'p1', type: 'number', label: '', value: 5 }));
    const p = s.parameters.get('p1') as any;
    expect(typeof p.min).toBe('number');
    expect(typeof p.max).toBe('number');
    expect(typeof p.step).toBe('number');
    expect(p.step).toBeGreaterThan(0);
  });

  it('sanitizes enum parameter: resets value if not in options', () => {
    const s = new Scenario();
    s.apply(msg('param_create', { id: 'e1', type: 'enum', label: '', value: 'missing', options: ['a', 'b', 'c'] }));
    const p = s.parameters.get('e1') as any;
    expect(p.options).toContain(p.value);
  });

  it('sanitizes boolean parameter: coerces string to boolean', () => {
    const s = new Scenario();
    s.apply(msg('param_create', { id: 'b1', type: 'boolean', label: '', value: 'false' }));
    const p = s.parameters.get('b1') as any;
    expect(p.value).toBe(false);
  });

  it('sanitizes string parameter: coerces number to string', () => {
    const s = new Scenario();
    s.apply(msg('param_create', { id: 's1', type: 'string', label: '', value: 42 }));
    const p = s.parameters.get('s1') as any;
    expect(typeof p.value).toBe('string');
    expect(p.value).toBe('42');
  });

  it('param_sync updates value and re-sanitizes enum', () => {
    const s = new Scenario();
    s.apply(msg('param_create', { id: 'e1', type: 'enum', label: '', value: 'a', options: ['a', 'b'] }));
    // sync to a valid value
    s.apply(msg('param_sync', { id: 'e1', value: 'b' }));
    expect((s.parameters.get('e1') as any).value).toBe('b');
  });

  it('param_sync with invalid enum value is reset to first option', () => {
    const s = new Scenario();
    s.apply(msg('param_create', { id: 'e1', type: 'enum', label: '', value: 'a', options: ['a', 'b'] }));
    s.apply(msg('param_sync', { id: 'e1', value: 'invalid' }));
    expect((s.parameters.get('e1') as any).value).toBe('a');
  });

  it('param_delete removes parameter', () => {
    const s = new Scenario();
    s.apply(msg('param_create', { id: 'p1', type: 'boolean', label: '', value: true }));
    s.apply(msg('param_delete', { id: 'p1' }));
    expect(s.parameters.has('p1')).toBe(false);
  });
});

// ── dump / load round-trip ────────────────────────────────────────────────────

describe('Scenario – dump / load', () => {
  it('dump/load round-trips environment and agent state', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    s.apply(msg('agent_create', { env_id: 'env1', layer_id: 'layer1', agents: [{ id: 'a1', x: 5, y: 10 }] }));

    const snap = s.dump();
    const s2 = new Scenario();
    s2.load(snap);

    const storage = s2.environments.get('env1')!.layers.get('layer1')!.storage as AgentStorage;
    expect(storage).toBeInstanceOf(AgentStorage);
    expect(storage.getData().agents.get('a1')).toMatchObject({ x: 5, y: 10 });
  });

  it('dump/load round-trips edge state', () => {
    const s = new Scenario();
    setupEnvAndEdgeLayer(s);
    s.apply(msg('edge_create', { env_id: 'env1', layer_id: 'edges', edges: [{ source: 'a', target: 'b' }] }));

    const snap = s.dump();
    const s2 = new Scenario();
    s2.load(snap);

    const storage = s2.environments.get('env1')!.layers.get('edges')!.storage as EdgeStorage;
    expect(storage).toBeInstanceOf(EdgeStorage);
    expect(storage.getEdgeCount()).toBe(1);
    expect(storage.findEdge('a', 'b')).toBeDefined();
  });

  it('dump/load round-trips parameters', () => {
    const s = new Scenario();
    s.apply(msg('param_create', { id: 'p1', type: 'boolean', label: 'P1', value: true }));
    const snap = s.dump();
    const s2 = new Scenario();
    s2.load(snap);
    expect(s2.parameters.get('p1')).toMatchObject({ id: 'p1', value: true });
  });

  it('dump/load round-trips metadata', () => {
    const s = new Scenario();
    s.apply(msg('metadata_update', { title: 'test', time: 42 }));
    const snap = s.dump();
    const s2 = new Scenario();
    s2.load(snap);
    expect(s2.metadata).toMatchObject({ title: 'test', time: 42 });
  });
});

// ── reset ─────────────────────────────────────────────────────────────────────

describe('Scenario – reset', () => {
  it('clears all state after reset', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    s.apply(msg('agent_create', { env_id: 'env1', layer_id: 'layer1', agents: [{ id: 'a1' }] }));
    s.apply(msg('param_create', { id: 'p1', type: 'boolean', label: '', value: true }));
    s.reset();
    expect(s.environments.size).toBe(0);
    expect(s.parameters.size).toBe(0);
  });

  it('emits reset event', () => {
    const s = new Scenario();
    const listener = vi.fn();
    s.addEventListener('reset', listener);
    s.reset();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// ── createStateSyncMessage ────────────────────────────────────────────────────

describe('Scenario – createStateSyncMessage', () => {
  it('includes current environments and layers', () => {
    const s = new Scenario();
    setupEnvAndAgentLayer(s);
    const msg2 = s.createStateSyncMessage();
    expect(msg2.type).toBe('state_sync');
    const envList = msg2.payload.envs;
    expect(envList).toHaveLength(1);
    expect(envList[0].layers).toHaveLength(1);
    expect(envList[0].layers[0].layer_type).toBe('agent');
  });
});
