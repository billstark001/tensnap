export interface TrajectoryPoint { 
  x: number; 
  y: number; 
  time: number;
}

export interface Agent {
  id: string | number;
  color?: string;
  icon?: AgentIcon;
  size?: number;
  data?: Record<string, any>;
}

export type AgentIcon = 'arrow' | 'circle' | 'square' | 'triangle';

// #region Grid Environment

export interface GridAgent extends Agent {
  x: number;
  y: number;
  heading: number;
  trajectory?: TrajectoryPoint[];
}


export interface GridEnvironment {
  id: string | number;
  type: 'grid';
  width: number;
  height: number;
  background?: Uint8Array | string;
  agents: GridAgent[];
  colormap?: string;
}

// #endregion

// #region Graph Environment

export interface GraphAgent extends Agent {
  x?: number;
  y?: number;
}

export interface GraphEdge {
  source: string | number;
  target: string | number;
  directed?: boolean;
  style?: 'solid' | 'dashed' | 'dotted';
  width?: number;
  color?: string;
}

export interface GraphEnvironment {
  id: string | number;
  type: 'graph';
  nodes: GraphAgent[];
  edges: GraphEdge[];
}

// #endregion

// #region Uniform Environment

export interface UniformAgent extends Agent {
  // no additional properties for now
}

export interface UniformEnvironment {
  id: string | number;
  type: 'uniform';
  agents: UniformAgent[];
}


// #endregion



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


export interface ChartData {
  id: string;
  label: string;
  getter: string;
  color?: string;
  data: { time: number; value: number }[];
}

export interface SimulationState {
  connected: boolean;
  currentTime: number;
  environments: Environment[];
  parameters: Parameter[];
  charts: ChartData[];
  snapshots: Snapshot[];
}

export interface Snapshot {
  id: string;
  timestamp: number;
  timeStep: number;
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
