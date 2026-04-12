
export type {
  Action,
  AgentIcon,
  AgentId,
  BaseAgent as Agent,
  BooleanParameter,
  ChartGroup,
  ChartGroupMetadata,
  ChartMetadata,
  ChartUpdateData,
  ChartUpdateOperation,
  EnumParameter,
  GraphAgent,
  GraphEdge,
  GridAgent,
  GridCoordOffset,
  GridEnvConfig,
  NativeDataPoint,
  NumberParameter,
  Parameter,
  ParameterBase,
  ParameterType,
  ScenarioEnvironmentSnapshot,
  ScenarioEnvironmentState,
  ScenarioLayerSnapshot,
  ScenarioLayerState,
  ScenarioSnapshot,
  StringParameter,
  TrajectoryPoint as AgentTrajectoryPoint,
} from '@tensnap/core';

export interface SnapshotIdentity {
  id: string;
  timestamp: number;
}

export function getSnapshotIdentity(snapshot: import('@tensnap/core').ScenarioSnapshot): SnapshotIdentity {
  return {
    id: String(snapshot.metadata.id ?? ''),
    timestamp: Number(snapshot.metadata.timestamp ?? 0),
  };
}
