/**
 * environment/storages/EdgeStorage.ts
 *
 * Stores graph edges with O(1) CRUD via internal Map index.
 * Simulation configuration has been moved to EdgeLayer.
 *
 * Each notification carries a `delta` describing what changed so that
 * consumers (e.g. EdgeLayer) can apply incremental updates instead of
 * rebuilding their entire state on every change.
 *
 * Delta semantics:
 *   - `replaced: true`  — the entire edge set was replaced; consumers must
 *     treat `added` as a full snapshot and discard previous state.
 *   - `replaced: false` — only `added` and `removed` arrays are meaningful.
 * After `notify()` fires, the pending delta is reset automatically so
 * subsequent `getData()` calls show an empty (no-op) delta.
 */

import { BaseStorage } from './BaseStorage';
import { GraphEdge, AgentId } from '../types';

// ---------------------------------------------------------------------------
// Delta / diff type
// ---------------------------------------------------------------------------

export type EdgeDelta = {
  /** Newly added or updated edges. */
  added: GraphEdge[];
  /** Edges that were updated (snapshot at update time). */
  updated: GraphEdge[];
  /** Edges that were removed (snapshot at removal time). */
  removed: GraphEdge[];
  /**
   * True when the entire edge set was replaced (setEdges / clearEdges).
   * Consumers should treat `added` as the new full snapshot and discard
   * any previously cached state.
   */
  replaced?: false;
} | {
  added?: undefined;
  updated?: undefined;
  removed?: undefined;
  replaced: true;
}

export interface EdgeStorageData {
  edges: Map<string, GraphEdge>;
  adjacentMap: Map<AgentId, Set<string>>;
}

export interface EdgeStorageSnapshot {
  edges: Array<{ source: AgentId; target: AgentId;[key: string]: unknown }>;
}

export class EdgeStorage extends BaseStorage<EdgeStorageData, EdgeDelta> {

  constructor(edges: GraphEdge[] = []) {
    super({ edges: new Map(), adjacentMap: new Map() });
    this._bulkInsert(edges);
  }

  override dump(): EdgeStorageSnapshot {
    return {
      edges: [...this._data.edges.values()].map((edge) => ({
        ...edge,
        source: EdgeStorage.resolveId(edge.source),
        target: EdgeStorage.resolveId(edge.target),
      })),
    };
  }

  override load(snapshot: unknown): void {
    const value = snapshot as EdgeStorageSnapshot;
    const edges = (value?.edges ?? []).map((edge) => ({ ...edge })) as GraphEdge[];
    this.setEdges(edges);
  }

  // -------------------------------------------------------------------------
  // Bulk / replace
  // -------------------------------------------------------------------------

  setEdges(edges: GraphEdge[]): void {
    this._data.edges.clear();
    this._data.adjacentMap.clear();
    this._bulkInsert(edges);
    this.notify({ replaced: true });
  }

  // -------------------------------------------------------------------------
  // Static helpers
  // -------------------------------------------------------------------------

  /** Helper: resolve source/target to AgentId (handle both raw id and object). */
  static resolveId(endpoint: AgentId | { id: AgentId }): AgentId {
    return typeof endpoint === 'object' && endpoint !== null
      ? (endpoint as { id: AgentId }).id
      : endpoint;
  }

  /** Canonical map key from two resolved AgentIds. */
  static edgeKey(source: AgentId, target: AgentId): string {
    return `${source}\x00${target}`;
  }

  // -------------------------------------------------------------------------
  // O(1) CRUD operations
  // -------------------------------------------------------------------------

  /** Add a single edge. O(1). */
  addEdge(edge: GraphEdge): void {
    const src = EdgeStorage.resolveId(edge.source);
    const tgt = EdgeStorage.resolveId(edge.target);
    const key = EdgeStorage.edgeKey(src, tgt);
    this._data.edges.set(key, edge);
    this._adjIndex(src).add(key);
    this._adjIndex(tgt).add(key);
    const delta: EdgeDelta = { added: [edge], updated: [], removed: [], replaced: false };
    this.notify(delta);
  }

  /** Add multiple edges. O(m). */
  addEdges(edges: GraphEdge[]): void {
    const delta: EdgeDelta = { added: [], updated: [], removed: [], replaced: false };
    for (const edge of edges) {
      const src = EdgeStorage.resolveId(edge.source);
      const tgt = EdgeStorage.resolveId(edge.target);
      const key = EdgeStorage.edgeKey(src, tgt);
      this._data.edges.set(key, edge);
      this._adjIndex(src).add(key);
      this._adjIndex(tgt).add(key);
      delta.added.push(edge);
    }
    this.notify(delta);
  }

  /** Update an existing edge by source/target. O(1). */
  updateEdge(source: AgentId, target: AgentId, updates: Partial<GraphEdge>): void {
    const key = EdgeStorage.edgeKey(source, target);
    const existing = this._data.edges.get(key);
    const delta: EdgeDelta = { added: [], updated: [], removed: [], replaced: false };
    if (!existing) {
      const newEdge = { source, target, ...updates } as GraphEdge;
      this.addEdge(newEdge);
      delta.added.push(newEdge);
    } else {
      Object.assign(existing, updates);
      delta.updated.push(existing);
    }
    this.notify(delta);
  }

  /** Update multiple edges. O(k). */
  updateEdges(updates: Array<Partial<GraphEdge> & { source: AgentId; target: AgentId }>): void {
    const delta: EdgeDelta = { added: [], updated: [], removed: [], replaced: false };
    for (const { source, target, ...data } of updates) {
      const key = EdgeStorage.edgeKey(source, target);
      const existing = this._data.edges.get(key);
      if (!existing) {
        const newEdge = { source, target, ...data } as GraphEdge;
        this._data.edges.set(key, newEdge);
        this._adjIndex(source).add(key);
        this._adjIndex(target).add(key);
        delta.added.push(newEdge);
      } else {
        Object.assign(existing, data);
        delta.updated.push(existing);
      }
    }
    if (delta.added.length > 0 || delta.updated.length > 0) {
      this.notify(delta);
    }
  }

  /** Remove edge by source and target. O(1). */
  removeEdge(source: AgentId, target: AgentId): void {
    const key = EdgeStorage.edgeKey(source, target);
    const edge = this._data.edges.get(key);
    if (!edge) return;
    this._data.edges.delete(key);
    this._data.adjacentMap.get(source)?.delete(key);
    this._data.adjacentMap.get(target)?.delete(key);
    const delta: EdgeDelta = { added: [], updated: [], removed: [edge], replaced: false };
    this.notify(delta);
  }

  removeEdgePairs(pairs: Array<{ source: AgentId; target: AgentId }>): void {
    const delta: EdgeDelta = { added: [], updated: [], removed: [], replaced: false };
    for (const pair of pairs) {
      const key = EdgeStorage.edgeKey(pair.source, pair.target);
      const edge = this._data.edges.get(key);
      if (!edge) continue;
      this._data.edges.delete(key);
      this._data.adjacentMap.get(pair.source)?.delete(key);
      this._data.adjacentMap.get(pair.target)?.delete(key);
      delta.removed.push(edge);
    }
    if (delta.removed.length > 0) {
      this.notify(delta);
    }
  }

  /** Remove edges matching a predicate. O(n). */
  removeEdges(predicate: (edge: GraphEdge) => boolean): void {
    const toDelete: string[] = [];
    for (const [key, edge] of this._data.edges) {
      if (predicate(edge)) toDelete.push(key);
    }
    if (toDelete.length === 0) return;
    const delta: EdgeDelta = { added: [], updated: [], removed: [], replaced: false };
    for (const key of toDelete) {
      const edge = this._data.edges.get(key)!;
      const src = EdgeStorage.resolveId(edge.source);
      const tgt = EdgeStorage.resolveId(edge.target);
      this._data.edges.delete(key);
      this._data.adjacentMap.get(src)?.delete(key);
      this._data.adjacentMap.get(tgt)?.delete(key);
      delta.removed.push(edge);
    }
    this.notify(delta);
  }

  /** Find edge by source and target. O(1). */
  findEdge(source: AgentId, target: AgentId): GraphEdge | undefined {
    return this._data.edges.get(EdgeStorage.edgeKey(source, target));
  }

  /** Get all edges for a specific agent (as source or target). O(degree). */
  getEdgesForAgent(agentId: AgentId): GraphEdge[] {
    const keys = this._data.adjacentMap.get(agentId);
    if (!keys) return [];
    const result: GraphEdge[] = [];
    for (const key of keys) {
      const edge = this._data.edges.get(key);
      if (edge) result.push(edge);
    }
    return result;
  }

  /** Get number of edges. O(1). */
  getEdgeCount(): number {
    return this._data.edges.size;
  }

  /** Clear all edges. O(1). */
  clearEdges(): void {
    this._data.edges.clear();
    this._data.adjacentMap.clear();
    this.notify({ replaced: true });
  }

  // -------------------------------------------------------------------------
  // Override notify() to attach & reset the pending delta
  // -------------------------------------------------------------------------

  override notify(delta: EdgeDelta): void {
    super.notify(delta);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------


  private _adjIndex(id: AgentId): Set<string> {
    let set = this._data.adjacentMap.get(id);
    if (!set) {
      set = new Set();
      this._data.adjacentMap.set(id, set);
    }
    return set;
  }

  private _bulkInsert(edges: GraphEdge[]): void {
    for (const edge of edges) {
      const src = EdgeStorage.resolveId(edge.source);
      const tgt = EdgeStorage.resolveId(edge.target);
      const key = EdgeStorage.edgeKey(src, tgt);
      this._data.edges.set(key, edge);
      this._adjIndex(src).add(key);
      this._adjIndex(tgt).add(key);
    }
  }
}
