
export type AgentIcon = 'arrow' | 'circle' | 'square' | 'triangle';

export type TileIcon = 'circle' | 'square' | 'triangle' | string;

export type EnvironmentType = 'grid' | 'graph' | 'uniform';

export type AgentId = string | number;

export type TileId = string | number;

export type EnvironmentId = string;

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

export interface Tile {
  id: TileId;
  x: number;
  y: number;
  color?: string;
  icon?: TileIcon;
  size?: number;
  shape?: string;
  layer?: number;  // Z-index for rendering order
  opacity?: number;  // 0.0 to 1.0
  rotation?: number;  // In radians
  data?: Record<string, any>;
}

export interface EnvironmentBase {
  id: EnvironmentId;
  type: EnvironmentType;
  label?: string;
  agents: Agent[];
  tiles?: Tile[];
}

// #region Grid Environment

export interface GridAgent extends Agent {
  x: number;
  y: number;
  heading: number;
  trajectory_length?: number;
  trajectory_color?: string;
}

export interface GridTile extends Tile {
  // Grid tiles have all base tile properties
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
  tiles?: GridTile[];
}

// #endregion

// #region Graph Environment

export interface GraphAgent extends Agent {
  x?: number;
  y?: number;
}

export interface GraphTile extends Tile {
  // Graph tiles have all base tile properties
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
  tiles?: GraphTile[];
}

// #endregion

// #region Uniform Environment

export interface UniformAgent extends Agent {
  // no additional properties for now
}

export interface UniformTile extends Tile {
  // Uniform tiles have all base tile properties
}

export interface PureUniformEnvironment {
  // no additional properties for now
}

export interface UniformEnvironment extends PureUniformEnvironment, EnvironmentBase {
  id: EnvironmentId;
  type: 'uniform';
  agents: UniformAgent[];
  tiles?: UniformTile[];
}


// #endregion

export type PureEnvironment = PureGridEnvironment | PureGraphEnvironment | PureUniformEnvironment;

export type Environment = GridEnvironment | GraphEnvironment | UniformEnvironment;

// #region Parameters


export type ParameterType = 'number' | 'enum' | 'action' | 'boolean' | 'string';

export interface ParameterBase {
  id: string;
  type: ParameterType;
  label: string;
  allowRuntimeChange?: boolean;
}

export interface NumberParameter extends ParameterBase {
  type: 'number';
  value: number;
  min: number;
  max: number;
  step: number;
}

export interface EnumParameter extends ParameterBase {
  type: 'enum';
  value: string;
  options: string[];
  labels?: Record<string, string>;
}

export interface ActionParameter extends ParameterBase {
  type: 'action';
}

export interface BooleanParameter extends ParameterBase {
  type: 'boolean';
  value: boolean;
}

export interface StringParameter extends ParameterBase {
  type: 'string';
  value: string;
}

export type Parameter = NumberParameter | EnumParameter | ActionParameter | BooleanParameter | StringParameter;


// #endregion

// #region Charts

export interface ChartMetadata {
  id: string;
  label: string;
  color?: string;
}

export interface ChartGroupMetadata extends ChartMetadata {
  dataList?: ChartMetadata[];
}

export type ChartUpdateOperationType = 'clear';

export interface ChartUpdateData {
  id: string;
  time?: number;
  value: any;
}

export interface ChartUpdateOperation {
  id: string;
  operation: ChartUpdateOperationType;
}

export interface NativeDataPoint {
  time: number;
  [key: string]: any;
}

export interface ChartGroup {
  id: string;
  label: string;
  metadataDict: Record<string, ChartMetadata>;
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
  charts: [],
  snapshots: [],
});

// #endregion
