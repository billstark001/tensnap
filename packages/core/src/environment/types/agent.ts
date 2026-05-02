/**
 * environment/types/agent.ts
 *
 * Agent-related type definitions for the environment rendering system.
 * Self-contained; does NOT reference @/types.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Base primitives
// ---------------------------------------------------------------------------

export const AgentIdSchema = z.union([z.string(), z.number()]);

export type AgentId = z.infer<typeof AgentIdSchema>;

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

export const BuiltinAgentIconSchema = z.enum(BUILTIN_AGENT_ICONS);
export const AssetAgentIconSchema = z.string().regex(/^asset:.+$/);
export const AgentIconSchema = z.union([BuiltinAgentIconSchema, AssetAgentIconSchema]);

export type BuiltinAgentIcon = z.infer<typeof BuiltinAgentIconSchema>;
export type AssetAgentIcon = z.infer<typeof AssetAgentIconSchema>;
export type AgentIcon = z.infer<typeof AgentIconSchema>;

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

export const AgentSchema = z.object({
  id: AgentIdSchema,
  color: z.string().optional(),
  icon: AgentIconSchema.optional(),
  size: z.number().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
}).loose();

export interface Agent {
  readonly id: AgentId;
  color?: string;
  icon?: AgentIcon;
  /** Logical size in abstract units (not pixels). */
  size?: number;
  data?: Record<string, unknown>;
}

export const AgentDiffSchema = z.object({
  id: AgentIdSchema,
}).loose();

export interface AgentDiff {
  id: AgentId;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Grid agent
// ---------------------------------------------------------------------------

export interface GridAgentState extends Agent {
  x: number;
  y: number;
  /** Heading in radians. */
  heading?: number;
}

// ---------------------------------------------------------------------------
// Graph agent
// ---------------------------------------------------------------------------

export interface GraphAgentState extends Agent {
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

export const TrajectoryConfigSchema = z.object({
  id: AgentIdSchema,
  length: z.number().optional(),
  width: z.number().optional(),
  color: z.string().optional(),
}).loose();

export interface TrajectoryConfig {
  readonly id: AgentId;
  length?: number;
  width?: number;
  color?: string;
}

export const TrajectoryConfigDiffSchema = z.object({
  id: AgentIdSchema,
}).loose();

export interface TrajectoryConfigDiff {
  id: AgentId;
  [key: string]: unknown;
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

export const EdgeDataSchema = z.object({
  source: AgentIdSchema,
  target: AgentIdSchema,
  directed: z.boolean().optional(),
  style: z.enum(['solid', 'dashed', 'dotted']).optional(),
  width: z.number().optional(),
  color: z.string().optional(),
}).loose();

export interface EdgeData {
  source: AgentId;
  target: AgentId;
  directed?: boolean;
  style?: 'solid' | 'dashed' | 'dotted';
  width?: number;
  color?: string;
  [key: string]: unknown;
}

export const EdgeDiffSchema = z.object({
  source: AgentIdSchema,
  target: AgentIdSchema,
}).loose();

export interface EdgeDiff {
  source: AgentId;
  target: AgentId;
  [key: string]: unknown;
}

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
