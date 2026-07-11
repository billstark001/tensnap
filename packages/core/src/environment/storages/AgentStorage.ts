/**
 * environment/storages/AgentStorage.ts
 *
 * Reactive store for agent display data.
 *
 * Specialized mutation methods allow:
 *   - `setAgents`         — full replace of the agent map
 *   - `mergePositions`    — back-channel write from d3-force (no re-notify until
 *                          `flushPositions` is called, to avoid hot-loop storms)
 *   - `setAgentFixed`     — pin / free a node during drag
 */

import { BaseStorage } from './BaseStorage';
import { AgentId, AgentIcon } from '../types';

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/** Unified agent record covering both grid- and graph-mode rendering. */
export interface AgentRenderState {
  id: AgentId;
  color?: string;
  icon?: AgentIcon;
  /** Logical size (abstract units). */
  size?: number;

  // ---- Coordinates ----
  /** X coordinate.  For graph mode: canvas pixels.  For grid mode: grid column. */
  x?: number;
  /** Y coordinate.  For graph mode: canvas pixels.  For grid mode: grid row. */
  y?: number;
  /** d3-force: velocity x (graph mode). */
  vx?: number;
  /** d3-force: velocity y (graph mode). */
  vy?: number;
  /** d3-force: fixed x (non-null while dragging, graph mode). */
  fx?: number | null;
  /** d3-force: fixed y (non-null while dragging, graph mode). */
  fy?: number | null;

  // ---- Grid extras ----
  /** Heading angle in radians (grid mode). */
  heading?: number;
  /** Extra application data (unused by the layer). */
  data?: Record<string, unknown>;
}


export type AgentDelta = {
  /** Newly added or updated agents. */
  added: AgentRenderState[];
  /** Agents that were removed (snapshot at removal time). */
  updated: AgentRenderState[];
  /** Agents that were removed (snapshot at removal time). */
  removed: AgentId[];
  /**
   * True when the entire agent set was replaced (setAgents / clearAgents).
   * Consumers should treat `added` as the new full snapshot and discard
   * any previously cached state.
   */
  replaced?: false;
  positionsFlushed?: false;
} | {
  added?: undefined;
  updated?: undefined;
  removed?: undefined;
  replaced: true;
  positionsFlushed?: false;
} | {
  added?: undefined;
  updated?: undefined;
  removed?: undefined;
  replaced?: false;
  /**
   * True when only positions/velocities were updated via mergePositions().
   * Consumers should only refresh node coordinates — no structural changes.
   */
  positionsFlushed: true;
}

export interface AgentStorageData {
  agents: Map<AgentId, AgentRenderState>;
}

export interface AgentStorageSnapshot {
  agents: AgentRenderState[];
}

export class AgentStorage extends BaseStorage<AgentStorageData, AgentDelta> {
  private static readonly SPATIAL_CELL_SIZE = 4;
  private readonly spatialCells = new Map<string, Set<AgentId>>();
  private readonly agentCells = new Map<AgentId, string>();

  constructor() {
    super({ agents: new Map() });
  }

  override dump(): AgentStorageSnapshot {
    return {
      agents: [...this._data.agents.values()].map((agent) => ({ ...agent })),
    };
  }

  override load(snapshot: unknown): void {
    const value = snapshot as AgentStorageSnapshot;
    this.setAgents(value?.agents ?? []);
  }

  // -------------------------------------------------------------------------
  // Full-replace mutations (trigger listeners)
  // -------------------------------------------------------------------------

  /** Replace the entire agent map and notify. */
  setAgents(agents: Iterable<AgentRenderState>): void {
    const map: Map<AgentId, AgentRenderState> = new Map();
    for (const a of agents) map.set(a.id, { ...a });
    this._data = { agents: map };
    this.rebuildSpatialIndex();
    this.notify({ replaced: true });
  }

  // -------------------------------------------------------------------------
  // Back-channel position writes from d3-force (EdgeLayer)
  // -------------------------------------------------------------------------

  /**
   * Silently update node positions in the agent map.
   * Call `flushPositions()` once per animation frame to trigger re-render.
   */
  mergePositions(
    positions: Map<AgentId, { x: number; y: number; vx?: number; vy?: number }>
  ): void {
    const agents = this._data.agents;
    positions.forEach((pos, id) => {
      const agent = agents.get(id);
      if (agent) {
        agent.x = pos.x;
        agent.y = pos.y;
        if (pos.vx !== undefined) agent.vx = pos.vx;
        if (pos.vy !== undefined) agent.vy = pos.vy;
        this.indexAgent(agent);
      }
    });
    // NOTE: deliberately no notify() here — call flushPositions() when ready.
  }

  /**
   * Fire listeners after a batch of `mergePositions` calls.
   * Typically called once per d3 tick.
   *
   * Uses the lightweight `positionsFlushed` delta so consumers only update
   * node coordinates instead of tearing down and rebuilding all nodes.
   */
  flushPositions(): void {
    this.notify({ positionsFlushed: true });
  }

  // -------------------------------------------------------------------------
  // Drag pinning (AgentLayer drag events)
  // -------------------------------------------------------------------------

  setAgentFixed(id: AgentId, fx: number | null, fy: number | null): void {
    const agent = this._data.agents.get(id);
    if (agent) {
      agent.fx = fx;
      agent.fy = fy;
    }
  }

  // -------------------------------------------------------------------------
  // Individual CRUD operations (maintain stable references)
  // -------------------------------------------------------------------------

  /** Add a single agent. If it exists, updates it in place. */
  addAgent(agent: AgentRenderState): void {
    const existing = this._data.agents.get(agent.id);
    if (existing) {
      // Update existing agent in place to maintain reference stability
      Object.assign(existing, agent);
      this.indexAgent(existing);
      this.notify({ added: [], updated: [existing], removed: [] });
    } else {
      const clonedAgent = { ...agent };
      this._data.agents.set(agent.id, clonedAgent);
      this.indexAgent(clonedAgent);
      this.notify({ added: [clonedAgent], updated: [], removed: [] });
    }
  }

  /** Add multiple agents efficiently. */
  addAgents(agents: Iterable<Readonly<AgentRenderState>>): void {
    const added: AgentRenderState[] = [];
    const updated: AgentRenderState[] = [];
    for (const agent of agents) {
      const existing = this._data.agents.get(agent.id);
      if (existing) {
        Object.assign(existing, agent);
        this.indexAgent(existing);
        updated.push(existing);
      } else {
        this._data.agents.set(agent.id, agent);
        this.indexAgent(agent);
        added.push(agent);
      }
    }
    if (added.length > 0 || updated.length > 0) {
      this.notify({ added, updated, removed: [] });
    }
  }

  /** Update an existing agent by ID. Creates if doesn't exist. */
  updateAgent(id: AgentId, updates: Partial<Readonly<AgentRenderState>>): void {
    const delta: AgentDelta = { added: [], updated: [], removed: [] };
    const existing = this._data.agents.get(id);
    if (existing) {
      Object.assign(existing, updates);
      this.indexAgent(existing);
      delta.updated.push(existing);
    } else {
      const newAgent = { id, ...updates } as AgentRenderState;
      this._data.agents.set(id, newAgent);
      this.indexAgent(newAgent);
      delta.added.push(newAgent);
    }
    this.notify(delta);
  }

  /** Update multiple agents efficiently. */
  updateAgents(updates: Array<Readonly<Partial<AgentRenderState> & { id: AgentId }>>): void {
    const delta: AgentDelta = { added: [], updated: [], removed: [] };
    for (const { id, ...data } of updates) {
      const existing = this._data.agents.get(id);
      if (existing) {
        Object.assign(existing, data);
        this.indexAgent(existing);
        delta.updated.push(existing);
      } else {
        const newAgent = { id, ...data } as AgentRenderState;
        this._data.agents.set(id, newAgent);
        this.indexAgent(newAgent);
        delta.added.push(newAgent);
      }
    }
    if (delta.added.length > 0 || delta.updated.length > 0) {
      this.notify(delta);
    }
  }

  /** Update multiple agents efficiently. Supports different data structures. */
  updateAgents2(updates: Array<{ id: AgentId; data: Readonly<Partial<AgentRenderState>> }>): void {
    const delta: AgentDelta = { added: [], updated: [], removed: [] };
    for (const { id, data } of updates) {
      const existing = this._data.agents.get(id);
      if (existing) {
        Object.assign(existing, data);
        this.indexAgent(existing);
        delta.updated.push(existing);
      } else {
        const newAgent = { id, ...data } as AgentRenderState;
        this._data.agents.set(id, newAgent);
        this.indexAgent(newAgent);
        delta.added.push(newAgent);
      }
    }
    if (delta.added.length > 0 || delta.updated.length > 0) {
      this.notify(delta);
    }
  }

  /** Remove a single agent by ID. */
  removeAgent(id: AgentId): void {
    if (this._data.agents.delete(id)) {
      this.unindexAgent(id);
      this.notify({ added: [], updated: [], removed: [id] });
    }
  }

  /** Remove multiple agents efficiently. */
  removeAgents(ids: Iterable<AgentId>): void {
    let changed = false;
    const removed = Array.from(ids);
    for (const id of removed) {
      if (this._data.agents.delete(id)) {
        this.unindexAgent(id);
        changed = true;
      }
    }
    if (changed) this.notify({ added: [], updated: [], removed });
  }

  /** Get a single agent by ID. */
  getAgent(id: AgentId): AgentRenderState | undefined {
    return this._data.agents.get(id);
  }

  /** Check if an agent exists. */
  hasAgent(id: AgentId): boolean {
    return this._data.agents.has(id);
  }

  /** Get all agent IDs. */
  getAgentIds(): AgentId[] {
    return Array.from(this._data.agents.keys());
  }

  /** Get number of agents. */
  getAgentCount(): number {
    return this._data.agents.size;
  }

  /** Clear all agents. */
  clearAgents(): void {
    this._data.agents.clear();
    this.spatialCells.clear();
    this.agentCells.clear();
    this.notify({ replaced: true });
  }

  /** Read-only view of the current agent map. */
  get agents(): ReadonlyMap<AgentId, AgentRenderState> {
    return this._data.agents;
  }

  /** Exact radius query backed by an incrementally maintained spatial hash. */
  getAgentsWithinRadius(x: number, y: number, radius: number): AgentRenderState[] {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius < 0) return [];
    const size = AgentStorage.SPATIAL_CELL_SIZE;
    const minX = Math.floor((x - radius) / size);
    const maxX = Math.floor((x + radius) / size);
    const minY = Math.floor((y - radius) / size);
    const maxY = Math.floor((y + radius) / size);
    const squaredRadius = radius * radius;
    const result: AgentRenderState[] = [];
    for (let cellX = minX; cellX <= maxX; cellX += 1) {
      for (let cellY = minY; cellY <= maxY; cellY += 1) {
        const ids = this.spatialCells.get(`${cellX}:${cellY}`);
        if (!ids) continue;
        for (const id of ids) {
          const agent = this._data.agents.get(id);
          const agentX = agent?.x;
          const agentY = agent?.y;
          if (
            agent
            && typeof agentX === 'number'
            && Number.isFinite(agentX)
            && typeof agentY === 'number'
            && Number.isFinite(agentY)
            && (agentX - x) ** 2 + (agentY - y) ** 2 <= squaredRadius
          ) {
            result.push(agent);
          }
        }
      }
    }
    return result;
  }

  private rebuildSpatialIndex(): void {
    this.spatialCells.clear();
    this.agentCells.clear();
    for (const agent of this._data.agents.values()) this.indexAgent(agent);
  }

  private indexAgent(agent: AgentRenderState): void {
    this.unindexAgent(agent.id);
    const x = agent.x;
    const y = agent.y;
    if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) return;
    const key = this.cellKey(x, y);
    const cell = this.spatialCells.get(key) ?? new Set<AgentId>();
    cell.add(agent.id);
    this.spatialCells.set(key, cell);
    this.agentCells.set(agent.id, key);
  }

  private unindexAgent(id: AgentId): void {
    const key = this.agentCells.get(id);
    if (!key) return;
    const cell = this.spatialCells.get(key);
    cell?.delete(id);
    if (cell?.size === 0) this.spatialCells.delete(key);
    this.agentCells.delete(id);
  }

  private cellKey(x: number, y: number): string {
    const size = AgentStorage.SPATIAL_CELL_SIZE;
    return `${Math.floor(x / size)}:${Math.floor(y / size)}`;
  }
}
