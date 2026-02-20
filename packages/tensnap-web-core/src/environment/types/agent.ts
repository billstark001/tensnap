/**
 * environment/types/agent.ts
 *
 * Agent-related type definitions for the environment rendering system.
 * Self-contained; does NOT reference @/types.
 */

// ---------------------------------------------------------------------------
// Base primitives
// ---------------------------------------------------------------------------

export type AgentId = string | number;

export type AgentIcon = 'arrow' | 'circle' | 'square' | 'triangle';

// ---------------------------------------------------------------------------
// Base agent
// ---------------------------------------------------------------------------

export interface BaseAgent {
  id: AgentId;
  color?: string;
  icon?: AgentIcon;
  /** Logical size in abstract units (not pixels). */
  size?: number;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Grid agent
// ---------------------------------------------------------------------------

export interface GridAgent extends BaseAgent {
  x: number;
  y: number;
  /** Heading in radians. */
  heading?: number;
  trajectory_length?: number;
  trajectory_color?: string;
}

// ---------------------------------------------------------------------------
// Graph agent
// ---------------------------------------------------------------------------

export interface GraphAgent extends BaseAgent {
  /** Canvas x position (updated by d3-force). */
  x?: number;
  /** Canvas y position (updated by d3-force). */
  y?: number;
  /** d3-force velocity x. */
  vx?: number;
  /** d3-force velocity y. */
  vy?: number;
  /** Fixed x position (non-null while dragging). */
  fx?: number | null;
  /** Fixed y position (non-null while dragging). */
  fy?: number | null;
}

// ---------------------------------------------------------------------------
// Trajectory
// ---------------------------------------------------------------------------

export interface TrajectoryPoint {
  x: number;
  y: number;
  time: number;
  color?: string;
}

// ---------------------------------------------------------------------------
// Edge
// ---------------------------------------------------------------------------

export interface GraphEdge {
  /** Source agent id (raw) or resolved agent object. */
  source: AgentId | GraphAgent;
  /** Target agent id (raw) or resolved agent object. */
  target: AgentId | GraphAgent;
  directed?: boolean;
  style?: 'solid' | 'dashed' | 'dotted';
  width?: number;
  color?: string;
}
