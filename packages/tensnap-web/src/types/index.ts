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
  background?: ArrayBuffer | string;
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

export interface Parameter {
  id: string;
  type: 'slider' | 'enum' | 'button';
  label: string;
  value?: number | string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  getter?: string;
  setter?: string;
  action?: string;
}

export interface ChartData {
  id: string;
  label: string;
  getter: string;
  color?: string;
  data: { time: number; value: number }[];
}

export interface WSMessage {
  type: string;
  payload: any;
  timestamp?: number;
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