
export type AgentIcon = 'arrow' | 'circle' | 'square' | 'triangle';

export type EnvironmentType = 'grid' | 'graph' | 'uniform';

export type AgentId = string | number;

export type EnvironmentId = string;

import type { Parameter } from '@tensnap/core';
import type { Action } from '@tensnap/core';
import type { ChartGroup } from '@tensnap/core';

export interface AgentTrajectoryPoint {
  x: number;
  y: number;
  time: number;
  color?: string;
}

export interface Agent {
  id: AgentId;
  color?: string;
  icon?: AgentIcon;
  size?: number;
  data?: Record<string, any>;
}

export interface EnvironmentBase {
  id: EnvironmentId;
  type: EnvironmentType;
  label?: string;
  agents: Agent[];
}

// #region Grid Environment

export interface GridAgent extends Agent {
  x: number;
  y: number;
  heading: number;
  trajectory_length?: number;
  trajectory_color?: string;
}

export type GridEnvironmentCoordOffset = 'int' | 'float';

export interface PureGridEnvironment {
  width: number;
  height: number;
  coord_offset?: GridEnvironmentCoordOffset; // default to 'int'
  background?: Uint8Array | string;
  trajectory_length?: number; // <=0: infinity
  trajectory_color?: string;
}

export interface GridEnvironment extends PureGridEnvironment, EnvironmentBase {
  id: EnvironmentId;
  type: 'grid';
  agents: GridAgent[];
}

// #endregion

// #region Graph Environment

export interface GraphAgent extends Agent {
  x?: number;
  y?: number;
}

export interface GraphEdge {
  source: AgentId;
  target: AgentId;
  directed?: boolean;
  style?: 'solid' | 'dashed' | 'dotted';
  width?: number;
  color?: string;
}

export interface PureGraphEnvironment {
  edges: GraphEdge[];
}

export interface GraphEnvironment extends PureGraphEnvironment, EnvironmentBase {
  id: EnvironmentId;
  type: 'graph';
  agents: GraphAgent[];
}

// #endregion

// #region Uniform Environment

export interface UniformAgent extends Agent {
  // no additional properties for now
}

export interface PureUniformEnvironment {
  // no additional properties for now
}

export interface UniformEnvironment extends PureUniformEnvironment, EnvironmentBase {
  id: EnvironmentId;
  type: 'uniform';
  agents: UniformAgent[];
}

// #endregion

export type PureEnvironment = PureGridEnvironment | PureGraphEnvironment | PureUniformEnvironment;

export type Environment = GridEnvironment | GraphEnvironment | UniformEnvironment;

// #region Parameters & Actions — sourced from @tensnap/core

export type {
  ParameterType,
  ParameterBase,
  NumberParameter,
  EnumParameter,
  BooleanParameter,
  StringParameter,
  Parameter,
  Action,
} from '@tensnap/core';

// #endregion

// #region Charts — sourced from @tensnap/core

export type {
  ChartMetadata,
  ChartGroupMetadata,
  NativeDataPoint,
  ChartGroup,
  ChartUpdateData,
} from '@tensnap/core';

// Protocol-specific chart operation types (not in web-core)
export type ChartUpdateOperationType = 'clear';

export interface ChartUpdateOperation {
  id: string;
  operation: ChartUpdateOperationType;
}

// #endregion

// #region Snapshots

export interface SimulationState {
  connected: boolean;
  currentTime: number;
  environments: Environment[];
  parameters: Parameter[];
  actions: Action[];
  charts: ChartGroup[];
  snapshots: Snapshot[];
}

export interface SnapshotChartData {
  id: string;
  value: number;
}

export interface SnapshotMetadata {
  id: string;
  timestamp: number;
  timeStep: number;
}

export interface Snapshot extends SnapshotMetadata {
  environments: Environment[];
  parameters: Parameter[];
  chartData: SnapshotChartData[];
}

export const defaultSimulationState = (): SimulationState => ({
  connected: false,
  currentTime: 0,
  environments: [],
  parameters: [],
  actions: [],
  charts: [],
  snapshots: [],
});

// #endregion
