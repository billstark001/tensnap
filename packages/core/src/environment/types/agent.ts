/**
 * environment/types/agent.ts
 *
 * Agent-related type definitions for the environment rendering system.
 * Protocol-facing item types come from @tensnap/protocol. This module only
 * defines renderer-owned state and helpers.
 */

import {
  BUILTIN_AGENT_ICONS,
  type AgentId,
  type AgentItem,
  type AssetAgentIcon,
  type BuiltinAgentIcon,
  type TrajectoryItem,
} from '@tensnap/protocol/layers';

type AgentBase = Pick<AgentItem, 'id' | 'color' | 'icon' | 'size' | 'data'>;

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
// Grid agent
// ---------------------------------------------------------------------------

export interface GridAgentState extends AgentBase {
  x: number;
  y: number;
  /** Heading in radians. */
  heading?: number;
}

// ---------------------------------------------------------------------------
// Graph agent
// ---------------------------------------------------------------------------

export interface GraphAgentState extends AgentBase {
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

export interface GlobalTrajectoryConfig {
  length: NonNullable<TrajectoryItem['length']>;
  width: NonNullable<TrajectoryItem['width']>;
  color: NonNullable<TrajectoryItem['color']>;
}

// ---------------------------------------------------------------------------
// Edge
// ---------------------------------------------------------------------------

export interface GraphEdge {
  /** Source agent id (raw) or resolved agent object. */
  readonly source: AgentId | GraphAgentState;
  /** Target agent id (raw) or resolved agent object. */
  readonly target: AgentId | GraphAgentState;
  directed?: boolean;
  style?: 'solid' | 'dashed' | 'dotted';
  width?: number;
  color?: string;
}
