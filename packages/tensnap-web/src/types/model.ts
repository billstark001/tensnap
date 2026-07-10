
export type {
  Action,
  BooleanParameter,
  ChartGroupMetadata,
  ChartMetadata,
  ChartUpdateData,
  ChartUpdateOperation,
  EnumParameter,
  NumberParameter,
  Parameter,
  ParameterBase,
  ParameterType,
  StringParameter,
} from '@tensnap/protocol';

export type {
  ChartGroup,
  ScenarioEnvironmentSnapshot,
  ScenarioEnvironmentState,
  ScenarioLayerSnapshot,
  ScenarioLayerState,
  ScenarioSnapshot,
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
import type { Snapshot } from '@tensnap/core/snapshot';

export interface SnapshotIdentity {
  id: string;
  timestamp: number;
}

export function getSnapshotIdentity(snapshot: Snapshot): SnapshotIdentity {
  return {
    id: snapshot.metadata.id,
    timestamp: snapshot.metadata.createdAt,
  };
}
