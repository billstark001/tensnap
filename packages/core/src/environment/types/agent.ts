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

export const BUILTIN_AGENT_ICONS = [
  'arrow',
  'circle',
  'square',
  'triangle',
  'diamond',
  'star',
  'hexagon',
  'cross',
  'plus',
  'pentagon',
] as const;

export type BuiltinAgentIcon = typeof BUILTIN_AGENT_ICONS[number];
export type AssetAgentIcon = `asset:${string}`;
export type AgentIcon = BuiltinAgentIcon | AssetAgentIcon;

export function isBuiltinAgentIcon(icon: string | undefined | null): icon is BuiltinAgentIcon {
  return !!icon && (BUILTIN_AGENT_ICONS as readonly string[]).includes(icon);
}

export function isAssetAgentIcon(icon: string | undefined | null): icon is AssetAgentIcon {
  return !!icon && icon.startsWith('asset:') && icon.length > 'asset:'.length;
}

export function getAssetIdFromIcon(icon: string | undefined | null): string | null {
  if (!isAssetAgentIcon(icon)) {
    return null;
  }
  return icon.slice('asset:'.length);
}

// ---------------------------------------------------------------------------
// Base agent
// ---------------------------------------------------------------------------

export interface BaseAgent {
  readonly id: AgentId;
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


export interface TrajectoryConfig {
  readonly id: AgentId;
  length?: number;
  width?: number;
  color?: string;
}

export type GlobalTrajectoryConfig = Omit<Required<TrajectoryConfig>, 'id'>;

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
  readonly source: AgentId | GraphAgent;
  /** Target agent id (raw) or resolved agent object. */
  readonly target: AgentId | GraphAgent;
  directed?: boolean;
  style?: 'solid' | 'dashed' | 'dotted';
  width?: number;
  color?: string;
}
