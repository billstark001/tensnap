import {
  AgentStorage,
  BaseAgent,
  EdgeStorage,
  GridAgent,
  GraphAgent,
  GraphEdge,
  ScenarioEnvironmentSnapshot,
  ScenarioEnvironmentState,
} from '@tensnap/core';

type AnyEnvironment = ScenarioEnvironmentState | ScenarioEnvironmentSnapshot;

type LiveLayer = ScenarioEnvironmentState['layers'] extends ReadonlyMap<any, infer T> ? T : never;
type SnapshotLayer = ScenarioEnvironmentSnapshot['layers'][number];

const isLiveEnvironment = (environment: AnyEnvironment): environment is ScenarioEnvironmentState => {
  return environment.layers instanceof Map;
};

const getLayers = (environment: AnyEnvironment): Array<LiveLayer | SnapshotLayer> => {
  return isLiveEnvironment(environment)
    ? [...environment.layers.values()]
    : environment.layers;
};

const getLayerByType = (environment: AnyEnvironment, layerType: string) => {
  return getLayers(environment).find((layer) => layer.layerType === layerType);
};

const getAgentStorageSnapshot = (environment: AnyEnvironment) => {
  const layer = getLayerByType(environment, 'agent');
  if (!layer) return { agents: [], trajectories: [] };
  if ('storage' in layer && layer.storage instanceof AgentStorage) {
    return layer.storage.dump();
  }
  if ('storageSnapshot' in layer) {
    return layer.storageSnapshot as { agents?: GridAgent[] | GraphAgent[]; trajectories?: Array<{ id: string; points: any[] }> };
  }
  return { agents: [], trajectories: [] };
};

const getEdgeStorageSnapshot = (environment: AnyEnvironment) => {
  const layer = getLayerByType(environment, 'edge');
  if (!layer) return { edges: [] };
  if ('storage' in layer && layer.storage instanceof EdgeStorage) {
    return layer.storage.dump();
  }
  if ('storageSnapshot' in layer) {
    return layer.storageSnapshot as { edges?: GraphEdge[] };
  }
  return { edges: [] };
};

export const getEnvironmentDisplayType = (environment: AnyEnvironment): 'grid' | 'graph' | 'uniform' => {
  if (environment.type === 'uniform') return 'uniform';
  if (getLayerByType(environment, 'grid')) return 'grid';
  if (getLayerByType(environment, 'edge')) return 'graph';
  return 'uniform';
};

export const toGridEnvironmentViewModel = (environment: AnyEnvironment) => {
  const agentSnapshot = getAgentStorageSnapshot(environment);
  const gridLayer = getLayerByType(environment, 'grid');
  const metadata = (gridLayer?.metadata ?? {}) as Record<string, unknown>;
  return {
    id: environment.id,
    props: metadata,
    agents: Object.fromEntries((agentSnapshot.agents ?? []).map((agent) => [agent.id, agent as GridAgent])) as Record<string | number, GridAgent>,
    agentTraces: Object.fromEntries((agentSnapshot.trajectories ?? []).map((entry) => [entry.id, entry.points])) as Record<string, any[]>,
  };
};

export const toGraphEnvironmentViewModel = (environment: AnyEnvironment) => {
  const agentSnapshot = getAgentStorageSnapshot(environment);
  const edgeSnapshot = getEdgeStorageSnapshot(environment);
  return {
    id: environment.id,
    agents: Object.fromEntries((agentSnapshot.agents ?? []).map((agent) => [agent.id, agent as GraphAgent])) as Record<string | number, GraphAgent>,
    edges: edgeSnapshot.edges ?? [],
  };
};

export const toUniformEnvironmentViewModel = (environment: AnyEnvironment) => {
  const agentSnapshot = getAgentStorageSnapshot(environment);
  return {
    id: environment.id,
    agents: Object.fromEntries((agentSnapshot.agents ?? []).map((agent) => [agent.id, agent])) as Record<string | number, BaseAgent>,
  };
};
