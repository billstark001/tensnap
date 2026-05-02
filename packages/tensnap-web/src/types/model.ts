
export type {
  Action,
  BooleanParameter,
  ChartGroup,
  ChartGroupMetadata,
  ChartMetadata,
  ChartUpdateData,
  ChartUpdateOperation,
  EnumParameter,
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
} from '@tensnap/core';

export type {
  AgentIcon,
  AgentId,
  Agent,
  GraphAgentState,
  GraphEdge,
  GridAgentState,
  GridCoordOffset,
  GridEnvConfig,
  TrajectoryPoint,
} from '@tensnap/core/environment';

export type { ChartSeriesPoint } from '@tensnap/core/chart';

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
