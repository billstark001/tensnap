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
export interface RenderableAgent {
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
  added: RenderableAgent[];
  /** Agents that were removed (snapshot at removal time). */
  updated: RenderableAgent[];
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
  agents: Map<AgentId, RenderableAgent>;
}

export interface AgentStorageSnapshot {
  agents: RenderableAgent[];
}

export class AgentStorage extends BaseStorage<AgentStorageData, AgentDelta> {
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
  setAgents(agents: Iterable<RenderableAgent>): void {
    const map: Map<AgentId, RenderableAgent> = new Map();
    for (const a of agents) map.set(a.id, { ...a });
    this._data = { agents: map };
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
  addAgent(agent: RenderableAgent): void {
    const existing = this._data.agents.get(agent.id);
    if (existing) {
      // Update existing agent in place to maintain reference stability
      Object.assign(existing, agent);
      this.notify({ added: [], updated: [existing], removed: [] });
    } else {
      const clonedAgent = { ...agent };
      this._data.agents.set(agent.id, clonedAgent);
      this.notify({ added: [clonedAgent], updated: [], removed: [] });
    }
  }

  /** Add multiple agents efficiently. */
  addAgents(agents: Iterable<Readonly<RenderableAgent>>): void {
    const added: RenderableAgent[] = [];
    const updated: RenderableAgent[] = [];
    for (const agent of agents) {
      const existing = this._data.agents.get(agent.id);
      if (existing) {
        Object.assign(existing, agent);
        updated.push(existing);
      } else {
        this._data.agents.set(agent.id, agent);
        added.push(agent);
      }
    }
    if (added.length > 0 || updated.length > 0) {
      this.notify({ added, updated, removed: [] });
    }
  }

  /** Update an existing agent by ID. Creates if doesn't exist. */
  updateAgent(id: AgentId, updates: Partial<Readonly<RenderableAgent>>): void {
    const delta: AgentDelta = { added: [], updated: [], removed: [] };
    const existing = this._data.agents.get(id);
    if (existing) {
      Object.assign(existing, updates);
      delta.updated.push(existing);
    } else {
      const newAgent = { id, ...updates } as RenderableAgent;
      this._data.agents.set(id, newAgent);
      delta.added.push(newAgent);
    }
    this.notify(delta);
  }

  /** Update multiple agents efficiently. */
  updateAgents(updates: Array<Readonly<Partial<RenderableAgent> & { id: AgentId }>>): void {
    const delta: AgentDelta = { added: [], updated: [], removed: [] };
    for (const { id, ...data } of updates) {
      const existing = this._data.agents.get(id);
      if (existing) {
        Object.assign(existing, data);
        delta.updated.push(existing);
      } else {
        const newAgent = { id, ...data } as RenderableAgent;
        this._data.agents.set(id, newAgent);
        delta.added.push(newAgent);
      }
    }
    if (delta.added.length > 0 || delta.updated.length > 0) {
      this.notify(delta);
    }
  }

  /** Update multiple agents efficiently. Supports different data structures. */
  updateAgents2(updates: Array<{ id: AgentId; data: Readonly<Partial<RenderableAgent>> }>): void {
    const delta: AgentDelta = { added: [], updated: [], removed: [] };
    for (const { id, data } of updates) {
      const existing = this._data.agents.get(id);
      if (existing) {
        Object.assign(existing, data);
        delta.updated.push(existing);
      } else {
        const newAgent = { id, ...data } as RenderableAgent;
        this._data.agents.set(id, newAgent);
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
      this.notify({ added: [], updated: [], removed: [id] });
    }
  }

  /** Remove multiple agents efficiently. */
  removeAgents(ids: Iterable<AgentId>): void {
    let changed = false;
    const removed = Array.from(ids);
    for (const id of removed) {
      if (this._data.agents.delete(id)) {
        changed = true;
      }
    }
    if (changed) this.notify({ added: [], updated: [], removed });
  }

  /** Get a single agent by ID. */
  getAgent(id: AgentId): RenderableAgent | undefined {
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
    this.notify({ replaced: true });
  }

  /** Read-only view of the current agent map. */
  get agents(): ReadonlyMap<AgentId, RenderableAgent> {
    return this._data.agents;
  }
}
