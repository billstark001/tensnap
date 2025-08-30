export interface Agent {
  id: string | number;
  x?: number;
  y?: number;
  heading?: number;
  color?: string;
  icon?: 'arrow' | 'circle' | 'square' | 'triangle';
  size?: number;
  data?: Record<string, any>;
  trajectory?: { x: number; y: number; time: number }[];
}

export interface GridEnvironment {
  id: string | number;
  type: 'grid';
  width: number;
  height: number;
  background?: Uint8Array | string;
  agents: Agent[];
  colormap?: string;
}

export interface GraphNode {
  id: string | number;
  x?: number;
  y?: number;
  color?: string;
  icon?: 'circle' | 'square' | 'triangle';
  size?: number;
  data?: Record<string, any>;
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
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type Environment = GridEnvironment | GraphEnvironment;

export type ParameterType = 'slider' | 'enum' | 'button';

export interface ParameterBase {
  id: string;
  type: ParameterType;
  label: string;
}

export interface SliderParameter extends ParameterBase {
  type: 'slider';
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

export type Parameter = SliderParameter | EnumParameter | ButtonParameter;

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
