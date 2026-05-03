import type { BackgroundData } from '../environment/storages/BackgroundStorage';
import type { GridEnvData } from '../environment/storages/GridEnvStorage';
import type { AgentRenderState } from '../environment/storages/AgentStorage';
import type { TrajectoryStorageSnapshot } from '../environment/storages/TrajectoryStorage';
import type { AgentStorage, BackgroundStorage, EdgeStorage, GridEnvStorage, TrajectoryStorage } from '../environment/storages';
import type { GraphEnvConfig, GraphEdge, GridCoordOffset, OriginMode } from '../environment/types';
import type { ScenarioEnvironmentSnapshot, ScenarioEnvironmentState, ScenarioLayerSnapshot, ScenarioLayerState } from './types';
import { findSceneBounds, layerRegistry, type LayerRegistryClass, type LayerRendererRole, type LayerSceneBounds, type SnapshotAgentLayerData, type SnapshotTrajectoryLayerData } from './layer-registry';

// #region Plan types

export interface BackgroundLayerPlan {
  role: 'background';
  kind: 'background';
  key: string;
  layerId: string;
  storage: BackgroundStorage;
  sceneBounds?: LayerSceneBounds;
  zIndex?: number;
}

export interface GridLayerPlan {
  role: 'grid';
  kind: 'grid';
  key: string;
  layerId: string;
  storage: GridEnvStorage;
  zIndex?: number;
}

export interface EdgeLayerPlan {
  role: 'edge';
  kind: 'edge';
  key: string;
  layerId: string;
  storage: EdgeStorage;
  agentLayerId: string;
  agentStorage: AgentStorage;
  config: GraphEnvConfig;
  zIndex?: number;
}

export interface TrajectoryLayerPlan {
  role: 'trajectory';
  kind: 'trajectory';
  key: string;
  layerId: string;
  storage: TrajectoryStorage;
  agentLayerId: string;
  coordOffset: GridCoordOffset;
  worldBounds?: LayerSceneBounds;
  zIndex: number;
}

export interface AgentLayerPlan {
  role: 'agent';
  kind: 'agent';
  key: string;
  layerId: string;
  storage: AgentStorage;
  coordOffset: GridCoordOffset;
  originMode: OriginMode;
  sceneBounds?: LayerSceneBounds;
  usesGraphInteraction: boolean;
  zIndex: number;
}

export interface RenderPlan {
  environmentId: string;
  buildKey: string;
  sceneBounds?: LayerSceneBounds;
  fitPadding: number;
  layers: RenderLayerPlan[];
  backgroundLayers: BackgroundLayerPlan[];
  gridLayers: GridLayerPlan[];
  edgeLayers: EdgeLayerPlan[];
  trajectoryLayers: TrajectoryLayerPlan[];
  agentLayers: AgentLayerPlan[];
}

export type RenderLayerPlan =
  | BackgroundLayerPlan
  | GridLayerPlan
  | EdgeLayerPlan
  | TrajectoryLayerPlan
  | AgentLayerPlan;

export interface RenderDataAgentLayer {
  id: string;
  coordOffset: GridCoordOffset;
  agents: AgentRenderState[];
}

export interface RenderDataTrajectoryLayer {
  id: string;
  agentLayerId?: string;
  coordOffset: GridCoordOffset;
  config: TrajectoryStorageSnapshot['config'];
  configs: Map<string | number, TrajectoryStorageSnapshot['configs'][number]>;
  trajectories: TrajectoryStorageSnapshot['trajectories'];
}

export interface RenderData {
  id: string;
  type: string;
  width?: number;
  height?: number;
  grid: GridEnvData;
  background: BackgroundData | null;
  backgroundSource: unknown;
  agentLayers: RenderDataAgentLayer[];
  trajectoryLayers: RenderDataTrajectoryLayer[];
  agents: AgentRenderState[];
  edges: GraphEdge[];
}
// #endregion

const DEFAULT_LAYER_Z_INDEX = {
  trajectory: 30,
  agent: 40,
} as const;

const storageIdentityMap = new WeakMap<object, number>();
let nextStorageIdentity = 1;

const getStorageIdentity = (storage: object): number => {
  const current = storageIdentityMap.get(storage);
  if (current !== undefined) {
    return current;
  }

  const next = nextStorageIdentity;
  nextStorageIdentity += 1;
  storageIdentityMap.set(storage, next);
  return next;
};

function getLayerBuildEntry(layer: ScenarioLayerState): string {
  const metadata = (layer.metadata ?? {}) as Record<string, unknown>;
  const metadataEntries = Object.keys(metadata)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => [key, metadata[key]] as const);
  const dependencyEntries = Object.entries(layer.dependencyLayerIds ?? {})
    .sort(([left], [right]) => left.localeCompare(right));

  return JSON.stringify({
    id: layer.id,
    layerType: layer.layerType,
    storageId: getStorageIdentity(layer.storage as object),
    dependencies: dependencyEntries,
    metadata: metadataEntries,
  });
}

function buildPlanKey(baseKey: string, derived: Record<string, unknown>): string {
  return JSON.stringify({ baseKey, ...derived });
}

export function getRenderBuildKey(environment: ScenarioEnvironmentState): string {
  return [...environment.layers.values()]
    .map(getLayerBuildEntry)
    .sort()
    .join('|');
}

// #region Registry helpers
function getRendererRole(layer: Pick<ScenarioLayerState, 'layerType'>, registry: LayerRegistryClass): LayerRendererRole | undefined {
  return registry.get(layer.layerType)?.renderer?.role;
}

function getSceneBoundsFromMetadata(layer: Pick<ScenarioLayerState, 'layerType' | 'metadata'>, registry: LayerRegistryClass): LayerSceneBounds | undefined {
  return registry.get(layer.layerType)?.view?.getSceneBounds?.((layer.metadata ?? {}) as Record<string, unknown>);
}

function getLayerZIndex(layer: Pick<ScenarioLayerState, 'layerType' | 'metadata'>, registry: LayerRegistryClass): number | undefined {
  return registry.get(layer.layerType)?.renderer?.getZIndex?.((layer.metadata ?? {}) as Record<string, unknown>);
}

function getCoordOffset(layer: Pick<ScenarioLayerState, 'layerType' | 'metadata'>, registry: LayerRegistryClass): GridCoordOffset {
  return registry.get(layer.layerType)?.renderer?.getCoordOffset?.((layer.metadata ?? {}) as Record<string, unknown>) ?? 'int';
}

function getGraphConfig(layer: Pick<ScenarioLayerState, 'layerType' | 'metadata'>, registry: LayerRegistryClass): GraphEnvConfig {
  return registry.get(layer.layerType)?.renderer?.getGraphConfig?.((layer.metadata ?? {}) as Record<string, unknown>) ?? ((layer.metadata ?? {}) as GraphEnvConfig);
}

function getBackgroundSource(layer: ScenarioLayerSnapshot, registry: LayerRegistryClass): unknown {
  return registry.get(layer.layerType)?.renderer?.getBackgroundSource?.((layer.metadata ?? {}) as Record<string, unknown>);
}

function getSnapshotAgentLayer(layer: ScenarioLayerSnapshot, registry: LayerRegistryClass): SnapshotAgentLayerData | undefined {
  return registry.get(layer.layerType)?.renderer?.getSnapshotAgentLayer?.(layer);
}

function getSnapshotTrajectoryLayer(layer: ScenarioLayerSnapshot, registry: LayerRegistryClass): SnapshotTrajectoryLayerData | undefined {
  return registry.get(layer.layerType)?.renderer?.getSnapshotTrajectoryLayer?.(layer);
}

function getSnapshotGridData(layer: ScenarioLayerSnapshot, registry: LayerRegistryClass): GridEnvData | undefined {
  return registry.get(layer.layerType)?.renderer?.getSnapshotGridData?.(layer);
}

function getSnapshotEdges(layer: ScenarioLayerSnapshot, registry: LayerRegistryClass): GraphEdge[] {
  return registry.get(layer.layerType)?.renderer?.getSnapshotEdges?.(layer) ?? [];
}

function getSnapshotBackground(layer: ScenarioLayerSnapshot, registry: LayerRegistryClass): BackgroundData | null | undefined {
  return registry.get(layer.layerType)?.renderer?.getSnapshotBackground?.(layer);
}
// #endregion

// #region Render plan
export function createRenderPlan(
  environment: ScenarioEnvironmentState,
  registry: LayerRegistryClass = layerRegistry,
): RenderPlan {
  const layerStates = [...environment.layers.values()];
  const sceneBounds = findSceneBounds(layerStates, registry);
  const hasEdgeLayer = layerStates.some((layer) => getRendererRole(layer, registry) === 'edge');

  const backgroundLayers: BackgroundLayerPlan[] = [];
  const gridLayers: GridLayerPlan[] = [];
  const edgeLayers: EdgeLayerPlan[] = [];
  const trajectoryLayers: TrajectoryLayerPlan[] = [];
  const agentLayers: AgentLayerPlan[] = [];
  const layerEntryById = new Map<string, string>();
  const layerStateById = new Map<string, ScenarioLayerState>();
  const agentStorageByLayerId = new Map<string, AgentStorage>();
  const agentMetadataByLayerId = new Map<string, Record<string, unknown>>();
  const agentLayerById = new Map<string, ScenarioLayerState>();
  const edgeLayerByAgentLayerId = new Map<string, EdgeLayerPlan>();
  let implicitTrajectoryLayerZIndex = DEFAULT_LAYER_Z_INDEX.trajectory;
  let implicitAgentLayerZIndex = DEFAULT_LAYER_Z_INDEX.agent;

  for (const layer of layerStates) {
    layerStateById.set(layer.id, layer);
    layerEntryById.set(layer.id, getLayerBuildEntry(layer));
    const role = getRendererRole(layer, registry);

    switch (role) {
      case 'background': {
        const baseKey = layerEntryById.get(layer.id)!;
        backgroundLayers.push({
          role: 'background',
          kind: 'background',
          key: buildPlanKey(baseKey, {}),
          layerId: layer.id,
          storage: layer.storage as BackgroundStorage,
          sceneBounds,
          zIndex: getLayerZIndex(layer, registry),
        });
        break;
      }
      case 'grid': {
        const baseKey = layerEntryById.get(layer.id)!;
        gridLayers.push({
          role: 'grid',
          kind: 'grid',
          key: buildPlanKey(baseKey, {}),
          layerId: layer.id,
          storage: layer.storage as GridEnvStorage,
          zIndex: getLayerZIndex(layer, registry),
        });
        break;
      }
      case 'agent':
        agentLayerById.set(layer.id, layer);
        agentStorageByLayerId.set(layer.id, layer.storage as AgentStorage);
        agentMetadataByLayerId.set(layer.id, (layer.metadata ?? {}) as Record<string, unknown>);
        break;
      default:
        break;
    }
  }

  for (const layer of layerStates) {
    if (getRendererRole(layer, registry) !== 'edge') {
      continue;
    }

    const linkedAgentLayerId = layer.dependencyLayerIds?.agent;
    if (!linkedAgentLayerId) {
      continue;
    }

    const linkedAgentStorage = agentStorageByLayerId.get(linkedAgentLayerId);
    if (!linkedAgentStorage) {
      continue;
    }

    const baseKey = layerEntryById.get(layer.id)!;
    const edgePlan: EdgeLayerPlan = {
      role: 'edge',
      kind: 'edge',
      key: buildPlanKey(baseKey, { agentStorageId: getStorageIdentity(linkedAgentStorage as object) }),
      layerId: layer.id,
      storage: layer.storage as EdgeStorage,
      agentLayerId: linkedAgentLayerId,
      agentStorage: linkedAgentStorage,
      config: getGraphConfig(layer, registry),
      zIndex: getLayerZIndex(layer, registry),
    };
    edgeLayers.push(edgePlan);
    edgeLayerByAgentLayerId.set(linkedAgentLayerId, edgePlan);
  }

  for (const layer of layerStates) {
    if (getRendererRole(layer, registry) !== 'trajectory') {
      continue;
    }

    const linkedAgentLayerId = layer.dependencyLayerIds?.agent;
    if (!linkedAgentLayerId) {
      continue;
    }

    const linkedAgentMetadata = agentMetadataByLayerId.get(linkedAgentLayerId);
    const linkedAgentLayer = agentLayerById.get(linkedAgentLayerId) ?? layerStateById.get(linkedAgentLayerId);
    const linkedEdgeLayer = edgeLayerByAgentLayerId.get(linkedAgentLayerId);
    const linkedAgentSceneBounds = linkedAgentMetadata
      ? getSceneBoundsFromMetadata({ layerType: linkedAgentLayer?.layerType ?? 'agent', metadata: linkedAgentMetadata }, registry) ?? sceneBounds
      : sceneBounds;
    const coordOffset = linkedEdgeLayer
      ? 'float'
      : linkedAgentLayer
        ? getCoordOffset(linkedAgentLayer, registry)
        : linkedAgentMetadata
          ? getCoordOffset({ layerType: 'agent', metadata: linkedAgentMetadata }, registry)
          : getCoordOffset(layer, registry);
    const worldBounds = linkedEdgeLayer ? undefined : linkedAgentSceneBounds;
    const zIndex = getLayerZIndex(layer, registry) ?? implicitTrajectoryLayerZIndex++;
    const baseKey = layerEntryById.get(layer.id)!;

    trajectoryLayers.push({
      role: 'trajectory',
      kind: 'trajectory',
      key: buildPlanKey(baseKey, { coordOffset, worldBounds, zIndex }),
      layerId: layer.id,
      storage: layer.storage as TrajectoryStorage,
      agentLayerId: linkedAgentLayerId,
      coordOffset,
      worldBounds,
      zIndex,
    });
  }

  for (const layer of layerStates) {
    if (getRendererRole(layer, registry) !== 'agent') {
      continue;
    }

    const linkedEdgeLayer = edgeLayerByAgentLayerId.get(layer.id);
    const usesGraphInteraction = Boolean(linkedEdgeLayer);
    const coordOffset = usesGraphInteraction ? 'float' : getCoordOffset(layer, registry);
    const originMode: OriginMode = usesGraphInteraction ? 'center' : 'bottom-left';
    const layerSceneBounds = usesGraphInteraction ? undefined : getSceneBoundsFromMetadata(layer, registry) ?? sceneBounds;
    const zIndex = getLayerZIndex(layer, registry) ?? implicitAgentLayerZIndex++;
    const baseKey = layerEntryById.get(layer.id)!;

    agentLayers.push({
      role: 'agent',
      kind: 'agent',
      key: buildPlanKey(baseKey, { usesGraphInteraction, coordOffset, originMode, zIndex }),
      layerId: layer.id,
      storage: layer.storage as AgentStorage,
      coordOffset,
      originMode,
      sceneBounds: layerSceneBounds,
      usesGraphInteraction,
      zIndex,
    });
  }

  return {
    environmentId: environment.id,
    buildKey: getRenderBuildKey(environment),
    sceneBounds,
    fitPadding: hasEdgeLayer ? 0.05 : 0,
    layers: [
      ...backgroundLayers,
      ...gridLayers,
      ...edgeLayers,
      ...trajectoryLayers,
      ...agentLayers,
    ],
    backgroundLayers,
    gridLayers,
    edgeLayers,
    trajectoryLayers,
    agentLayers,
  };
}
// #endregion

// #region Snapshot collection
export function collectRenderData(
  environment: ScenarioEnvironmentSnapshot,
  registry: LayerRegistryClass = layerRegistry,
): RenderData {
  const aggregated: RenderData = {
    id: environment.id,
    type: environment.type,
    grid: {},
    background: null,
    backgroundSource: undefined,
    agentLayers: [],
    trajectoryLayers: [],
    agents: [],
    edges: [],
  };

  const sceneBounds = findSceneBounds(environment.layers as ScenarioLayerSnapshot[], registry);
  if (sceneBounds) {
    aggregated.width = sceneBounds.width;
    aggregated.height = sceneBounds.height;
  }

  for (const layer of environment.layers) {
    const backgroundSource = getBackgroundSource(layer, registry);
    if (typeof backgroundSource !== 'undefined') {
      aggregated.backgroundSource = backgroundSource;
    }

    const gridData = getSnapshotGridData(layer, registry);
    if (gridData) {
      Object.assign(aggregated.grid, gridData);
    }

    const snapshotAgentLayer = getSnapshotAgentLayer(layer, registry);
    if (snapshotAgentLayer) {
      const agentLayer: RenderDataAgentLayer = {
        id: layer.id,
        coordOffset: snapshotAgentLayer.coordOffset,
        agents: snapshotAgentLayer.agents,
      };
      aggregated.agentLayers.push(agentLayer);
      aggregated.agents.push(...agentLayer.agents.map((agent) => ({ ...agent })));
    }

    const snapshotTrajectoryLayer = getSnapshotTrajectoryLayer(layer, registry);
    if (snapshotTrajectoryLayer) {
      aggregated.trajectoryLayers.push({
        id: layer.id,
        agentLayerId: snapshotTrajectoryLayer.agentLayerId,
        coordOffset: snapshotTrajectoryLayer.coordOffset,
        config: snapshotTrajectoryLayer.config,
        configs: snapshotTrajectoryLayer.configs,
        trajectories: snapshotTrajectoryLayer.trajectories,
      });
    }

    aggregated.edges.push(...getSnapshotEdges(layer, registry));

    const background = getSnapshotBackground(layer, registry);
    if (typeof background !== 'undefined') {
      aggregated.background = background;
    }
  }

  const agentCoordOffsetByLayerId = new Map(
    aggregated.agentLayers.map((layer) => [layer.id, layer.coordOffset]),
  );
  for (const layer of aggregated.trajectoryLayers) {
    if (layer.agentLayerId) {
      layer.coordOffset = agentCoordOffsetByLayerId.get(layer.agentLayerId) ?? layer.coordOffset;
    }
  }

  return aggregated;
}
// #endregion