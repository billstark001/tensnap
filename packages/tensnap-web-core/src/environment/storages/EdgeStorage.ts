/**
 * environment/storages/EdgeStorage.ts
 *
 * Stores graph edges and d3-force simulation configuration.
 */

import { BaseStorage } from './BaseStorage';
import { GraphEdge, AgentId } from '../types';
import { GraphEnvConfig } from '../types/env';

export interface EdgeStorageData {
  edges: GraphEdge[];
  config: GraphEnvConfig;
}

const DEFAULT_GRAPH_CONFIG: Required<GraphEnvConfig> = {
  linkDistance: 80,
  chargeStrength: -300,
  collisionRadius: 25,
  maxComponentDistance: 120,
  componentSpacing: 120,
};

export class EdgeStorage extends BaseStorage<EdgeStorageData> {
  constructor(edges: GraphEdge[] = [], config: GraphEnvConfig = {}) {
    super({ edges, config: { ...DEFAULT_GRAPH_CONFIG, ...config } });
  }

  setEdges(edges: GraphEdge[]): void {
    this._data = { ...this._data, edges };
    this.notify();
  }

  setConfig(config: GraphEnvConfig): void {
    this._data = {
      ...this._data,
      config: { ...DEFAULT_GRAPH_CONFIG, ...config },
    };
    this.notify();
  }

  /** Helper: resolve source/target to AgentId (handle both raw id and object). */
  static resolveId(endpoint: AgentId | { id: AgentId }): AgentId {
    return typeof endpoint === 'object' && endpoint !== null
      ? (endpoint as { id: AgentId }).id
      : endpoint;
  }

  // -------------------------------------------------------------------------
  // Individual CRUD operations (maintain stable references)
  // -------------------------------------------------------------------------

  /** Add a single edge. Maintains array reference stability. */
  addEdge(edge: GraphEdge): void {
    this._data.edges.push(edge);
    this.notify();
  }

  /** Add multiple edges efficiently. */
  addEdges(edges: GraphEdge[]): void {
    this._data.edges.push(...edges);
    this.notify();
  }

  /** Remove edges by index. */
  removeEdgeAt(index: number): void {
    if (index >= 0 && index < this._data.edges.length) {
      this._data.edges.splice(index, 1);
      this.notify();
    }
  }

  /** Remove edges matching a predicate. */
  removeEdges(predicate: (edge: GraphEdge) => boolean): void {
    const initialLength = this._data.edges.length;
    this._data.edges = this._data.edges.filter(e => !predicate(e));
    if (this._data.edges.length !== initialLength) {
      this.notify();
    }
  }

  /** Find edge by source and target. */
  findEdge(source: AgentId, target: AgentId): GraphEdge | undefined {
    return this._data.edges.find(e => 
      EdgeStorage.resolveId(e.source) === source && 
      EdgeStorage.resolveId(e.target) === target
    );
  }

  /** Get all edges for a specific agent (as source or target). */
  getEdgesForAgent(agentId: AgentId): GraphEdge[] {
    return this._data.edges.filter(e =>
      EdgeStorage.resolveId(e.source) === agentId ||
      EdgeStorage.resolveId(e.target) === agentId
    );
  }

  /** Get number of edges. */
  getEdgeCount(): number {
    return this._data.edges.length;
  }

  /** Clear all edges. */
  clearEdges(): void {
    this._data.edges = [];
    this.notify();
  }
}
