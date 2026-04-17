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
  // Merge agents from ALL 'agent' type layers (models like wolf-sheep have separate layers
  // for terrain patches and animals; both end up as 'agent' layers after requireStorage coercion).
  const agentLayers = getLayers(environment).filter((l) => l.layerType === 'agent');
  const agents: Array<GridAgent | GraphAgent> = [];
  const trajectories: Array<{ id: string; points: any[] }> = [];
  for (const layer of agentLayers) {
    let snapshot: { agents?: GridAgent[] | GraphAgent[]; trajectories?: Array<{ id: string; points: any[] }> } | null = null;
    if ('storage' in layer && layer.storage instanceof AgentStorage) {
      snapshot = layer.storage.dump();
    } else if ('storageSnapshot' in layer) {
      snapshot = layer.storageSnapshot as { agents?: GridAgent[] | GraphAgent[]; trajectories?: Array<{ id: string; points: any[] }> };
    }
    if (snapshot) {
      agents.push(...(snapshot.agents ?? []));
      trajectories.push(...(snapshot.trajectories ?? []));
    }
  }
  return { agents, trajectories };
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
  // For '2d' environments without layers yet (e.g. during initial load before layer messages
  // arrive), default to 'grid' rather than 'uniform' to avoid misclassification.
  return (environment as ScenarioEnvironmentState).type === 'uniform' ? 'uniform' : 'grid';
};

export const toGridEnvironmentViewModel = (environment: AnyEnvironment) => {
  const agentSnapshot = getAgentStorageSnapshot(environment);
  // Prefer dedicated 'grid' layer for metadata (grid lines). Fall back to any layer that
  // carries width/height (happens when adapters use 'grid' layer_type for agent layers,
  // which Scenario.requireStorage coerces to 'agent' while preserving the metadata).
  const gridLayer = getLayerByType(environment, 'grid');
  const metadataLayer = gridLayer ?? getLayers(environment).find(
    (l) => typeof ((l.metadata ?? ({} as Record<string, unknown>)) as Record<string, unknown>).width === 'number',
  );
  const metadata = ((metadataLayer as LiveLayer | SnapshotLayer | undefined)?.metadata ?? {}) as Record<string, unknown>;
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
