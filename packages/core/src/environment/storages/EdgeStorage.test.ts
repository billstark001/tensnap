import { describe, it, expect, vi } from 'vitest';
import { EdgeStorage } from './EdgeStorage';

// ── Basic CRUD ────────────────────────────────────────────────────────────────

describe('EdgeStorage – addEdge / addEdges', () => {
  it('adds a single edge', () => {
    const s = new EdgeStorage();
    s.addEdge({ source: 'a', target: 'b' });
    expect(s.getEdgeCount()).toBe(1);
    expect(s.findEdge('a', 'b')).toBeDefined();
  });

  it('addEdges adds multiple edges at once', () => {
    const s = new EdgeStorage();
    s.addEdges([
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ]);
    expect(s.getEdgeCount()).toBe(2);
  });

  it('constructor accepts initial edges', () => {
    const s = new EdgeStorage([{ source: 'x', target: 'y' }]);
    expect(s.getEdgeCount()).toBe(1);
  });
});

describe('EdgeStorage – findEdge / getEdgesForAgent', () => {
  it('findEdge returns undefined for missing edge', () => {
    const s = new EdgeStorage();
    expect(s.findEdge('a', 'b')).toBeUndefined();
  });

  it('findEdge returns the edge after adding it', () => {
    const s = new EdgeStorage();
    s.addEdge({ source: 'a', target: 'b', weight: 3 } as any);
    expect(s.findEdge('a', 'b')).toMatchObject({ source: 'a', target: 'b' });
  });

  it('getEdgesForAgent returns edges where the agent is source or target', () => {
    const s = new EdgeStorage();
    s.addEdges([
      { source: 'a', target: 'b' },
      { source: 'c', target: 'a' },
      { source: 'b', target: 'c' },
    ]);
    const edges = s.getEdgesForAgent('a');
    expect(edges).toHaveLength(2);
  });

  it('getEdgesForAgent returns empty array for unknown agent', () => {
    const s = new EdgeStorage();
    expect(s.getEdgesForAgent('ghost')).toEqual([]);
  });
});

describe('EdgeStorage – updateEdge / updateEdges', () => {
  it('updateEdge modifies an existing edge', () => {
    const s = new EdgeStorage([{ source: 'a', target: 'b' }]);
    s.updateEdge('a', 'b', { weight: 5 } as any);
    expect((s.findEdge('a', 'b') as any).weight).toBe(5);
  });

  it('updateEdge creates edge if it does not exist', () => {
    const s = new EdgeStorage();
    s.updateEdge('a', 'b', {});
    expect(s.getEdgeCount()).toBe(1);
  });

  it('updateEdges modifies multiple edges', () => {
    const s = new EdgeStorage([
      { source: 'a', target: 'b' },
      { source: 'c', target: 'd' },
    ]);
    s.updateEdges([
      { source: 'a', target: 'b', weight: 10 } as any,
      { source: 'c', target: 'd', weight: 20 } as any,
    ]);
    expect((s.findEdge('a', 'b') as any).weight).toBe(10);
    expect((s.findEdge('c', 'd') as any).weight).toBe(20);
  });
});

describe('EdgeStorage – removeEdge / removeEdgePairs', () => {
  it('removeEdge removes the edge', () => {
    const s = new EdgeStorage([{ source: 'a', target: 'b' }]);
    s.removeEdge('a', 'b');
    expect(s.getEdgeCount()).toBe(0);
  });

  it('removeEdge is a no-op for non-existent edge', () => {
    const s = new EdgeStorage();
    expect(() => s.removeEdge('a', 'b')).not.toThrow();
  });

  it('removeEdgePairs removes multiple edges by source/target pairs', () => {
    const s = new EdgeStorage([
      { source: 'a', target: 'b' },
      { source: 'c', target: 'd' },
      { source: 'e', target: 'f' },
    ]);
    s.removeEdgePairs([{ source: 'a', target: 'b' }, { source: 'c', target: 'd' }]);
    expect(s.getEdgeCount()).toBe(1);
    expect(s.findEdge('e', 'f')).toBeDefined();
  });

  it('adjacent index cleaned up after removal', () => {
    const s = new EdgeStorage([{ source: 'a', target: 'b' }]);
    s.removeEdge('a', 'b');
    expect(s.getEdgesForAgent('a')).toHaveLength(0);
    expect(s.getEdgesForAgent('b')).toHaveLength(0);
  });
});

describe('EdgeStorage – clearEdges', () => {
  it('clears all edges', () => {
    const s = new EdgeStorage([{ source: 'a', target: 'b' }, { source: 'c', target: 'd' }]);
    s.clearEdges();
    expect(s.getEdgeCount()).toBe(0);
  });
});

// ── Subscriber notifications ──────────────────────────────────────────────────

describe('EdgeStorage – subscriber notifications', () => {
  it('notifies subscriber with added delta on addEdge', () => {
    const s = new EdgeStorage();
    const listener = vi.fn();
    s.subscribe(listener);
    s.addEdge({ source: 'a', target: 'b' });
    expect(listener).toHaveBeenCalledTimes(1);
    const [, delta] = listener.mock.calls[0];
    expect(delta.added).toHaveLength(1);
  });

  it('notifies subscriber with removed delta on removeEdge', () => {
    const s = new EdgeStorage([{ source: 'a', target: 'b' }]);
    const listener = vi.fn();
    s.subscribe(listener);
    s.removeEdge('a', 'b');
    const [, delta] = listener.mock.calls[0];
    expect(delta.removed).toHaveLength(1);
  });

  it('notifies with replaced:true on clearEdges', () => {
    const s = new EdgeStorage([{ source: 'a', target: 'b' }]);
    const listener = vi.fn();
    s.subscribe(listener);
    s.clearEdges();
    const [, delta] = listener.mock.calls[0];
    expect(delta.replaced).toBe(true);
  });

  it('unsubscribing stops notifications', () => {
    const s = new EdgeStorage();
    const listener = vi.fn();
    const unsub = s.subscribe(listener);
    unsub();
    s.addEdge({ source: 'a', target: 'b' });
    expect(listener).not.toHaveBeenCalled();
  });
});

// ── dump / load round-trip ────────────────────────────────────────────────────

describe('EdgeStorage – dump / load', () => {
  it('dump returns edges array with resolved ids', () => {
    const s = new EdgeStorage([
      { source: 'a', target: 'b' },
      { source: 'c', target: 'd' },
    ]);
    const snap = s.dump();
    expect(snap.edges).toHaveLength(2);
    expect(snap.edges[0]).toMatchObject({ source: 'a', target: 'b' });
  });

  it('load restores edges from snapshot', () => {
    const s = new EdgeStorage([{ source: 'a', target: 'b' }, { source: 'c', target: 'd' }]);
    const snap = s.dump();

    const s2 = new EdgeStorage();
    s2.load(snap);
    expect(s2.getEdgeCount()).toBe(2);
    expect(s2.findEdge('a', 'b')).toBeDefined();
    expect(s2.findEdge('c', 'd')).toBeDefined();
  });

  it('load with null snapshot does not throw', () => {
    const s = new EdgeStorage();
    expect(() => s.load(null)).not.toThrow();
    expect(s.getEdgeCount()).toBe(0);
  });
});
