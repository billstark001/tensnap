import { describe, it, expect, vi } from 'vitest';
import { AgentStorage } from './AgentStorage';

// ── Basic CRUD ────────────────────────────────────────────────────────────────

describe('AgentStorage – addAgent / addAgents', () => {
  it('adds a single agent and makes it retrievable via getData', () => {
    const s = new AgentStorage();
    s.addAgent({ id: 'a1', x: 10, y: 20 });
    const agents = [...s.getData().agents.values()];
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ id: 'a1', x: 10, y: 20 });
  });

  it('addAgent on existing id updates in place', () => {
    const s = new AgentStorage();
    s.addAgent({ id: 'a1', x: 0, y: 0 });
    const ref = [...s.getData().agents.values()][0];
    s.addAgent({ id: 'a1', x: 99, y: 99 });
    // same logical agent, updated fields
    expect(s.getData().agents.get('a1')).toMatchObject({ x: 99, y: 99 });
    // reference should be the same object (stable ref)
    expect(s.getData().agents.get('a1')).toBe(ref);
  });

  it('addAgents adds multiple agents at once', () => {
    const s = new AgentStorage();
    s.addAgents([{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }]);
    expect(s.getData().agents.size).toBe(3);
  });

  it('addAgents with duplicate id in the same batch updates existing', () => {
    const s = new AgentStorage();
    s.addAgent({ id: 'a1', x: 0 });
    s.addAgents([{ id: 'a1', x: 5 }, { id: 'a2', x: 7 }]);
    expect(s.getData().agents.get('a1')?.x).toBe(5);
    expect(s.getData().agents.size).toBe(2);
  });

  it('does not retain a caller-owned record passed to addAgents', () => {
    const s = new AgentStorage();
    const agent = { id: 'a1', x: 1 };
    s.addAgents([agent]);
    agent.x = 99;
    expect(s.getAgent('a1')?.x).toBe(1);
  });

  it('owns nested agent data on ingress and snapshot export', () => {
    const storage = new AgentStorage();
    const data = { nested: { value: 1 } };
    storage.setAgents([{ id: 'a', data }]);
    data.nested.value = 2;
    expect(storage.getAgent('a')?.data).toEqual({ nested: { value: 1 } });

    const snapshot = storage.dump();
    (snapshot.agents[0].data as { nested: { value: number } }).nested.value = 3;
    expect(storage.getAgent('a')?.data).toEqual({ nested: { value: 1 } });
  });

  it('does not partially apply a batch with uncloneable nested data', () => {
    const storage = new AgentStorage();
    storage.addAgent({ id: 'existing', x: 1 });
    const revision = storage.revision;

    expect(() => storage.addAgents([
      { id: 'existing', x: 2 },
      { id: 'invalid', data: { callback: () => 1 } },
    ])).toThrow();
    expect(storage.getAgent('existing')?.x).toBe(1);
    expect(storage.hasAgent('invalid')).toBe(false);
    expect(storage.revision).toBe(revision);
  });
});

describe('AgentStorage – updateAgent / updateAgents', () => {
  it('updateAgent changes specific fields', () => {
    const s = new AgentStorage();
    s.addAgent({ id: 'a1', x: 1, y: 2, color: 'red' });
    s.updateAgent('a1', { color: 'blue' });
    expect(s.getData().agents.get('a1')).toMatchObject({ x: 1, y: 2, color: 'blue' });
  });

  it('updateAgent creates a new agent when id does not exist', () => {
    const s = new AgentStorage();
    s.updateAgent('new', { x: 5, y: 5 });
    expect(s.getData().agents.has('new')).toBe(true);
  });

  it('keeps the lookup key authoritative when an update includes another id', () => {
    const s = new AgentStorage();
    s.addAgent({ id: 'original', x: 1, y: 1 });
    const release = s.retainSpatialIndex();
    s.updateAgent('original', { id: 'other', x: 2 });
    expect(s.getAgent('original')).toMatchObject({ id: 'original', x: 2 });
    expect(s.getAgentsWithinRadius(2, 1, 1).map((agent) => agent.id)).toEqual(['original']);
    expect(s.getAgent('other')).toBeUndefined();
    release();
  });

  it('updateAgents updates multiple agents in one call', () => {
    const s = new AgentStorage();
    s.addAgents([{ id: 'a1', x: 0 }, { id: 'a2', x: 0 }]);
    s.updateAgents([{ id: 'a1', x: 10 }, { id: 'a2', x: 20 }]);
    expect(s.getData().agents.get('a1')?.x).toBe(10);
    expect(s.getData().agents.get('a2')?.x).toBe(20);
  });

  it('does not retain nested data passed through a partial update', () => {
    const storage = new AgentStorage();
    storage.addAgent({ id: 'a' });
    const data = { nested: { value: 1 } };
    storage.updateAgent('a', { data });
    data.nested.value = 2;
    expect(storage.getAgent('a')?.data).toEqual({ nested: { value: 1 } });
  });
});

describe('AgentStorage – removeAgent / removeAgents', () => {
  it('removeAgent removes the agent', () => {
    const s = new AgentStorage();
    s.addAgents([{ id: 'a1' }, { id: 'a2' }]);
    s.removeAgent('a1');
    expect(s.getData().agents.has('a1')).toBe(false);
    expect(s.getData().agents.has('a2')).toBe(true);
  });

  it('removeAgents removes multiple agents', () => {
    const s = new AgentStorage();
    s.addAgents([{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }]);
    s.removeAgents(['a1', 'a3']);
    expect(s.getData().agents.size).toBe(1);
    expect(s.getData().agents.has('a2')).toBe(true);
  });

  it('removeAgent is a no-op for unknown id', () => {
    const s = new AgentStorage();
    expect(() => s.removeAgent('ghost')).not.toThrow();
  });

  it('reports only IDs actually removed by a batch', () => {
    const s = new AgentStorage();
    s.addAgent({ id: 'a1' });
    const listener = vi.fn();
    s.subscribe(listener);
    s.removeAgents(['missing', 'a1', 'a1']);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][1].removed).toEqual(['a1']);
  });
});

describe('AgentStorage – setAgents full replace', () => {
  it('replaces all existing agents', () => {
    const s = new AgentStorage();
    s.addAgents([{ id: 'old1' }, { id: 'old2' }]);
    s.setAgents([{ id: 'new1' }]);
    expect(s.getData().agents.size).toBe(1);
    expect(s.getData().agents.has('new1')).toBe(true);
  });

  it('queries a spatial hash and keeps it in sync with updates and removals', () => {
    const s = new AgentStorage();
    s.addAgents([
      { id: 'near', x: 1, y: 1 },
      { id: 'far', x: 100, y: 100 },
      { id: 'edge', x: 3, y: 4 },
    ]);
    expect(s.getAgentsWithinRadius(0, 0, 5).map((agent) => agent.id).sort()).toEqual(['edge', 'near']);

    s.updateAgent('near', { x: 50, y: 50 });
    s.removeAgent('edge');
    expect(s.getAgentsWithinRadius(0, 0, 5)).toEqual([]);
    expect(s.revision).toBeGreaterThan(0);
  });

  it('maintains the spatial hash only while retained', () => {
    const s = new AgentStorage();
    s.setAgents([
      { id: 'near', x: 1, y: 1 },
      { id: 'far', x: 20, y: 20 },
    ]);

    // One-shot callers remain correct without enabling incremental indexing.
    expect(s.getAgentsWithinRadius(0, 0, 3).map((agent) => agent.id)).toEqual(['near']);

    const release = s.retainSpatialIndex();
    s.updateAgent('near', { x: 10, y: 10 });
    s.updateAgent('far', { x: 2, y: 2 });
    expect(s.getAgentsWithinRadius(0, 0, 3).map((agent) => agent.id)).toEqual(['far']);

    release();
    s.updateAgent('near', { x: 1, y: 1 });
    expect(s.getAgentsWithinRadius(0, 0, 3).map((agent) => agent.id).sort()).toEqual(['far', 'near']);
  });

  it('falls back to a bounded scan for huge retained-index queries', () => {
    const s = new AgentStorage();
    s.setAgents([
      { id: 'near', x: 1e199, y: 0 },
      { id: 'far', x: 1e300, y: 0 },
    ]);
    const release = s.retainSpatialIndex();
    expect(s.getAgentsWithinRadius(0, 0, 1e200).map((agent) => agent.id)).toEqual(['near']);
    expect(s.getAgentsWithinRadius(1e300, 0, 1).map((agent) => agent.id)).toEqual(['far']);
    release();
  });
});

// ── Subscription / notification ───────────────────────────────────────────────

describe('AgentStorage – subscriber notifications', () => {
  it('notifies subscriber on addAgent', () => {
    const s = new AgentStorage();
    const listener = vi.fn();
    s.subscribe(listener);
    s.addAgent({ id: 'a1' });
    expect(listener).toHaveBeenCalledTimes(1);
    const [, delta] = listener.mock.calls[0];
    expect(delta.added).toHaveLength(1);
  });

  it('notifies subscriber on removeAgent', () => {
    const s = new AgentStorage();
    s.addAgent({ id: 'a1' });
    const listener = vi.fn();
    s.subscribe(listener);
    s.removeAgent('a1');
    expect(listener).toHaveBeenCalledTimes(1);
    const [, delta] = listener.mock.calls[0];
    expect(delta.removed).toContain('a1');
  });

  it('notifies with replaced:true on setAgents', () => {
    const s = new AgentStorage();
    const listener = vi.fn();
    s.subscribe(listener);
    s.setAgents([{ id: 'x' }]);
    const [, delta] = listener.mock.calls[0];
    expect(delta.replaced).toBe(true);
  });

  it('unsubscribing stops notifications', () => {
    const s = new AgentStorage();
    const listener = vi.fn();
    const unsub = s.subscribe(listener);
    unsub();
    s.addAgent({ id: 'a1' });
    expect(listener).not.toHaveBeenCalled();
  });
});

// ── dump / load round-trip ────────────────────────────────────────────────────

describe('AgentStorage – dump / load', () => {
  it('dump returns agents array', () => {
    const s = new AgentStorage();
    s.addAgents([{ id: 'a1', x: 1 }, { id: 'a2', x: 2 }]);
    const snap = s.dump();
    expect(snap.agents).toHaveLength(2);
    expect(snap.agents.map(a => a.id)).toEqual(expect.arrayContaining(['a1', 'a2']));
  });

  it('load restores agents from snapshot', () => {
    const s = new AgentStorage();
    s.addAgents([{ id: 'a1', x: 10, color: 'red' }]);
    const snap = s.dump();

    const s2 = new AgentStorage();
    s2.load(snap);
    expect(s2.getData().agents.get('a1')).toMatchObject({ x: 10, color: 'red' });
  });

  it('load with null/undefined snapshot does not throw', () => {
    const s = new AgentStorage();
    expect(() => s.load(null)).not.toThrow();
    expect(() => s.load(undefined)).not.toThrow();
    expect(s.getData().agents.size).toBe(0);
  });
});
