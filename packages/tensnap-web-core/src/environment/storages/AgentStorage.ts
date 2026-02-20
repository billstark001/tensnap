/**
 * environment/storages/AgentStorage.ts
 *
 * Reactive store for agent display data + optional trajectories.
 *
 * Specialized mutation methods allow:
 *   - `setAgents`         — full replace of the agent map
 *   - `setTrajectories`   — full replace of trajectory data (pruned to maxPoints)
 *   - `mergePositions`    — back-channel write from d3-force (no re-notify until
 *                          `flushPositions` is called, to avoid hot-loop storms)
 *   - `setAgentFixed`     — pin / free a node during drag
 */

import { BaseStorage } from './BaseStorage';
import { AgentId, AgentIcon, TrajectoryPoint } from '../types';

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
  /** Override trajectory color for this agent. */
  trajectoryColor?: string;
  /** Extra application data (unused by the layer). */
  data?: Record<string, unknown>;
}

export interface AgentStorageData {
  agents: Map<AgentId, RenderableAgent>;
  trajectories: Map<string, TrajectoryPoint[]>;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TRAJECTORY = 1000;

export class AgentStorage extends BaseStorage<AgentStorageData> {
  private readonly _maxTrajectoryPoints: number;

  constructor(maxTrajectoryPoints = DEFAULT_MAX_TRAJECTORY) {
    super({ agents: new Map(), trajectories: new Map() });
    this._maxTrajectoryPoints = maxTrajectoryPoints;
  }

  // -------------------------------------------------------------------------
  // Full-replace mutations (trigger listeners)
  // -------------------------------------------------------------------------

  /** Replace the entire agent map and notify. */
  setAgents(agents: Iterable<RenderableAgent>): void {
    const map: Map<AgentId, RenderableAgent> = new Map();
    for (const a of agents) map.set(a.id, { ...a });
    this._data = { ...this._data, agents: map };
    this.notify();
  }

  /** Replace trajectory data (automatically trims to max points) and notify. */
  setTrajectories(trajectories: Record<string, TrajectoryPoint[]>): void {
    const map: Map<string, TrajectoryPoint[]> = new Map();
    for (const [id, pts] of Object.entries(trajectories)) {
      if (!pts?.length) continue;
      map.set(
        id,
        pts.length > this._maxTrajectoryPoints
          ? pts.slice(-this._maxTrajectoryPoints)
          : pts
      );
    }
    this._data = { ...this._data, trajectories: map };
    this.notify();
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
   */
  flushPositions(): void {
    this.notify();
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
}
