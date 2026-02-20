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
}
