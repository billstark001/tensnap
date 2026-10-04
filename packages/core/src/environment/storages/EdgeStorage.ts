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
 *   - `replaced: false` — `added`, `updated`, and `removed` describe the delta.
 * Deltas are emitted to subscribers with each mutation; getData() returns
 * the current indexes rather than retaining a pending delta.
 */

import { BaseStorage } from './BaseStorage';
import type { AgentId } from '@tensnap/protocol/layers';
import type { GraphEdge } from '../types';

// ---------------------------------------------------------------------------
// Delta / diff type
// ---------------------------------------------------------------------------

export type EdgeDelta = {
  /** Newly added or updated edges. */
  added: GraphEdge[];
  /** Edges that were updated. */
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

  /** Canonical map key that preserves string/number identity and embedded separators. */
  static edgeKey(source: AgentId, target: AgentId): string {
    return JSON.stringify([source, target]);
  }

  // -------------------------------------------------------------------------
  // O(1) CRUD operations
  // -------------------------------------------------------------------------

  /** Add a single edge. O(1). */
  addEdge(edge: GraphEdge): void {
    const owned = EdgeStorage.ownEdge(edge);
    const src = owned.source as AgentId;
    const tgt = owned.target as AgentId;
    const key = EdgeStorage.edgeKey(src, tgt);
    const existed = this._data.edges.has(key);
    this._data.edges.set(key, owned);
    this._adjIndex(src).add(key);
    this._adjIndex(tgt).add(key);
    const delta: EdgeDelta = {
      added: existed ? [] : [owned], updated: existed ? [owned] : [], removed: [], replaced: false,
    };
    this.notify(delta);
  }

  /** Add multiple edges. O(m). */
  addEdges(edges: GraphEdge[]): void {
    const ownedEdges = edges.map(EdgeStorage.ownEdge);
    const delta: EdgeDelta = { added: [], updated: [], removed: [], replaced: false };
    for (const edge of ownedEdges) {
      const src = edge.source as AgentId;
      const tgt = edge.target as AgentId;
      const key = EdgeStorage.edgeKey(src, tgt);
      const existed = this._data.edges.has(key);
      this._data.edges.set(key, edge);
      this._adjIndex(src).add(key);
      this._adjIndex(tgt).add(key);
      if (existed) delta.updated.push(edge);
      else delta.added.push(edge);
    }
    if (delta.added.length > 0 || delta.updated.length > 0) this.notify(delta);
  }

  /** Update an existing edge by source/target. O(1). */
  updateEdge(source: AgentId, target: AgentId, updates: Partial<GraphEdge>): void {
    const key = EdgeStorage.edgeKey(source, target);
    const existing = this._data.edges.get(key);
    // Endpoints identify the map and adjacency entries; attributes cannot
    // silently re-key them. This matches updateEdges' endpoint handling.
    const data = { ...updates };
    delete data.source;
    delete data.target;
    if (!existing) {
      this.addEdge({ source, target, ...data } as GraphEdge);
      return;
    }
    Object.assign(existing, data);
    this.notify({ added: [], updated: [existing], removed: [], replaced: false });
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

  /** Resolve the induced edge set in O(sum(degree)) rather than scanning E. */
  getEdgesForAgents(agentIds: Iterable<AgentId>): GraphEdge[] {
    const keys = new Set<string>();
    for (const id of agentIds) {
      for (const key of this._data.adjacentMap.get(id) ?? []) keys.add(key);
    }
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

  private static ownEdge(edge: GraphEdge): GraphEdge {
    return {
      ...edge,
      source: EdgeStorage.resolveId(edge.source),
      target: EdgeStorage.resolveId(edge.target),
    };
  }

  private _bulkInsert(edges: GraphEdge[]): void {
    for (const edge of edges) {
      const owned = EdgeStorage.ownEdge(edge);
      const src = owned.source as AgentId;
      const tgt = owned.target as AgentId;
      const key = EdgeStorage.edgeKey(src, tgt);
      this._data.edges.set(key, owned);
      this._adjIndex(src).add(key);
      this._adjIndex(tgt).add(key);
    }
  }
}
