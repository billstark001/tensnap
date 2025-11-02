
export type AgentIcon = 'arrow' | 'circle' | 'square' | 'triangle';

export type EnvironmentType = 'grid' | 'graph' | 'uniform';

export type AgentId = string | number;

export type EnvironmentId = string | number;

export interface TrajectoryPoint { 
  x: number; 
  y: number; 
  time: number;
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
  agents: Agent[];
}

// #region Grid Environment

export interface GridAgent extends Agent {
  x: number;
  y: number;
  heading: number;
  trajectory?: TrajectoryPoint[];
}


export interface PureGridEnvironment {
  width: number;
  height: number;
  background?: Uint8Array | string;
  colormap?: string;
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

// #region Parameters


export type ParameterType = 'number' | 'enum' | 'button' | 'checkbox' | 'string';

export interface ParameterBase {
  id: string;
  type: ParameterType;
  label: string;
}

export interface SliderParameter extends ParameterBase {
  type: 'number';
  value: number;
  min: number;
  max: number;
  step: number;
}

export interface EnumParameter extends ParameterBase {
  type: 'enum';
  value: string;
  options: string[]; // | {label: string; value: any}[];
}

export interface ButtonParameter extends ParameterBase {
  type: 'button';
}

export interface CheckboxParameter extends ParameterBase {
  type: 'checkbox';
  value: boolean;
}

export interface StringParameter extends ParameterBase {
  type: 'string';
  value: string;
}

export type Parameter = SliderParameter | EnumParameter | ButtonParameter | CheckboxParameter | StringParameter;


// #endregion

// #region Charts

export interface ChartMetadata {
  id: string;
  label: string;
  color?: string;
}
export interface ChartDataUpdate {
  id: string;
  time?: number;
  value: any;
}

export interface NativeDataPoint {
  time: number;
  [key: string]: any;
}

export interface ChartGroup {
  id: string;
  label: string;
  metadataList: Record<string, ChartMetadata>;
  data: NativeDataPoint[];
}

// #endregion

// #region Logs

// TODO

// #endregion

// #region Snapshots

export interface SimulationState {
  connected: boolean;
  currentTime: number;
  environments: Environment[];
  parameters: Parameter[];
  charts: ChartGroup[];
  snapshots: Snapshot[];
}

export interface SnapshotMetadata {
  id: string;
  timestamp: number;
  timeStep: number;
}

export interface Snapshot extends SnapshotMetadata {
  environments: Environment[];
  parameters: Parameter[];
}

export const defaultSimulationState = (): SimulationState => ({
  connected: false,
  currentTime: 0,
  environments: [],
  parameters: [],
  charts: [],
  snapshots: [],
});

// #endregion
