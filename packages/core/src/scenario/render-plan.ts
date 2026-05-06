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

/**
 * Fallback plan type for layer types with registered renderer roles that are
 * not one of the five built-in roles.
 */
export interface GenericLayerPlan {
  role: string;
  kind: 'generic';
  key: string;
  layerId: string;
  /** The live storage instance held by the ScenarioLayerState. */
  storage: unknown;
  metadata: Record<string, unknown>;
  zIndex?: number;
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
  /** Plans for custom/third-party layer roles not handled by built-in loops. */
  genericLayers: GenericLayerPlan[];
}

export type RenderLayerPlan =
  | BackgroundLayerPlan
  | GridLayerPlan
  | EdgeLayerPlan
  | TrajectoryLayerPlan
  | AgentLayerPlan
  | GenericLayerPlan;

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

function buildRoleOrder(
  rolesInPlan: Set<string>,
  registry: LayerRegistryClass,
): string[] {
  const preferredOrder = registry.getRenderOrder();
  const preferredIndex = new Map<string, number>();
  preferredOrder.forEach((role, index) => preferredIndex.set(role, index));

  const indegree = new Map<string, number>();
  const outgoing = new Map<string, Set<string>>();
  for (const role of rolesInPlan) {
    indegree.set(role, 0);
    outgoing.set(role, new Set());
  }

  for (const role of rolesInPlan) {
    const def = registry.getDefinitionByRole(role);
    const deps = def?.renderer?.dependencies ?? [];
    for (const dep of deps) {
      if (!rolesInPlan.has(dep.fromRole)) continue;
      const fromSet = outgoing.get(dep.fromRole)!;
      if (fromSet.has(role)) continue;
      fromSet.add(role);
      indegree.set(role, (indegree.get(role) ?? 0) + 1);
    }
  }

  const ready: string[] = [...rolesInPlan].filter((role) => (indegree.get(role) ?? 0) === 0);
  ready.sort((left, right) => {
    const li = preferredIndex.get(left) ?? Number.MAX_SAFE_INTEGER;
    const ri = preferredIndex.get(right) ?? Number.MAX_SAFE_INTEGER;
    return li - ri || left.localeCompare(right);
  });

  const result: string[] = [];
  while (ready.length > 0) {
    const role = ready.shift()!;
    result.push(role);

    for (const next of outgoing.get(role) ?? []) {
      const nextIndegree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nextIndegree);
      if (nextIndegree === 0) {
        ready.push(next);
      }
    }

    ready.sort((left, right) => {
      const li = preferredIndex.get(left) ?? Number.MAX_SAFE_INTEGER;
      const ri = preferredIndex.get(right) ?? Number.MAX_SAFE_INTEGER;
      return li - ri || left.localeCompare(right);
    });
  }

  if (result.length === rolesInPlan.size) {
    return result;
  }

  // Cycles fall back to registry preference, then remaining lexical order.
  const fallback = [...rolesInPlan].sort((left, right) => {
    const li = preferredIndex.get(left) ?? Number.MAX_SAFE_INTEGER;
    const ri = preferredIndex.get(right) ?? Number.MAX_SAFE_INTEGER;
    return li - ri || left.localeCompare(right);
  });
  return fallback;
}

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

function getUsesGraphInteraction(layer: Pick<ScenarioLayerState, 'layerType' | 'metadata'>, registry: LayerRegistryClass): boolean {
  return registry.get(layer.layerType)?.renderer?.getUsesGraphInteraction?.((layer.metadata ?? {}) as Record<string, unknown>) ?? false;
}

function getOriginMode(layer: Pick<ScenarioLayerState, 'layerType' | 'metadata'>, registry: LayerRegistryClass): OriginMode {
  return registry.get(layer.layerType)?.renderer?.getOriginMode?.((layer.metadata ?? {}) as Record<string, unknown>) ?? 'bottom-left';
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

// #region Single-pass plan construction with deferred agent pass
/**
 * Build a RenderPlan from a ScenarioEnvironmentState using a single pass over
 * layers, with a deferred second pass for agents (so edge layers registered by
 * linked agents that appear later in the layer list are available).
 *
 * All role-specific decisions (usesGraphInteraction, coordOffset, originMode,
 * fitPadding) are delegated to the registry.
 */
export function createRenderPlan(
  environment: ScenarioEnvironmentState,
  registry: LayerRegistryClass = layerRegistry,
): RenderPlan {
  const layerStates = [...environment.layers.values()];
  const sceneBounds = findSceneBounds(layerStates, registry);

  const backgroundLayers: BackgroundLayerPlan[] = [];
  const gridLayers: GridLayerPlan[] = [];
  const edgeLayers: EdgeLayerPlan[] = [];
  const trajectoryLayers: TrajectoryLayerPlan[] = [];
  const agentLayers: AgentLayerPlan[] = [];
  const genericLayers: GenericLayerPlan[] = [];
  const layerEntryById = new Map<string, string>();
  const layerStateById = new Map<string, ScenarioLayerState>();

  // Cross-layer caches built during the single pass
  const agentStorageByLayerId = new Map<string, AgentStorage>();
  const agentMetadataByLayerId = new Map<string, Record<string, unknown>>();
  const agentLayerById = new Map<string, ScenarioLayerState>();
  const edgeLayerByAgentLayerId = new Map<string, EdgeLayerPlan>();
  let implicitTrajectoryLayerZIndex = DEFAULT_LAYER_Z_INDEX.trajectory;
  let implicitAgentLayerZIndex = DEFAULT_LAYER_Z_INDEX.agent;

  // Compute fit padding from all registered renderers' contribution
  let fitPadding = 0;

  // Pass 1: cache metadata and build plans for all non-agent layers.
  // Agent layers are cached but their plans are deferred to Pass 2 so that
  // edge layers (which may appear before or after their linked agent) are
  // available for graph-interaction resolution.
  for (const layer of layerStates) {
    layerStateById.set(layer.id, layer);
    layerEntryById.set(layer.id, getLayerBuildEntry(layer));
    const role = getRendererRole(layer, registry);
    const metadata = (layer.metadata ?? {}) as Record<string, unknown>;
    const baseKey = layerEntryById.get(layer.id)!;

    // Accumulate fit padding from each layer's registry rule
    const layerFitPadding = registry.get(layer.layerType)?.renderer?.getFitPadding?.(metadata) ?? 0;
    if (layerFitPadding > fitPadding) {
      fitPadding = layerFitPadding;
    }

    switch (role) {
      case 'background': {
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

      case 'edge': {
        const linkedAgentLayerId = layer.dependencyLayerIds?.agent;
        if (!linkedAgentLayerId) {
          break;
        }

        const linkedAgentStorage = agentStorageByLayerId.get(linkedAgentLayerId);
        if (!linkedAgentStorage) {
          break;
        }

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
        break;
      }

      case 'trajectory': {
        const linkedAgentLayerId = layer.dependencyLayerIds?.agent;
        if (!linkedAgentLayerId) {
          break;
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
        break;
      }

      case 'agent': {
        // Cache agent metadata for trajectory/edge resolution in later layers
        // but do NOT build the agent plan yet — edge layers may not be cached.
        agentLayerById.set(layer.id, layer);
        agentStorageByLayerId.set(layer.id, layer.storage as AgentStorage);
        agentMetadataByLayerId.set(layer.id, metadata);
        break;
      }

      default: {
        // Unrecognized role — handle as generic
        if (role) {
          genericLayers.push({
            role,
            kind: 'generic',
            key: buildPlanKey(baseKey, {}),
            layerId: layer.id,
            storage: layer.storage,
            metadata,
            zIndex: getLayerZIndex(layer, registry),
          });
        }
        // If no role, skip (unregistered layer type)
        break;
      }
    }
  }

  // Second-chance pass for edge layers whose linked agent appeared earlier in
  // the map but wasn't yet cached in the agentStorageByLayerId map.
  for (const layer of layerStates) {
    const role = getRendererRole(layer, registry);
    if (role !== 'edge') continue;
    if (edgeLayers.some((el) => el.layerId === layer.id)) continue; // already processed

    const linkedAgentLayerId = layer.dependencyLayerIds?.agent;
    if (!linkedAgentLayerId || !agentStorageByLayerId.has(linkedAgentLayerId)) continue;

    const linkedAgentStorage = agentStorageByLayerId.get(linkedAgentLayerId)!;
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

  // Pass 2: build agent plans now that all edge layers are available.
  for (const layer of layerStates) {
    const role = getRendererRole(layer, registry);
    if (role !== 'agent') continue;

    const baseKey = layerEntryById.get(layer.id)!;
    const linkedEdgeLayer = edgeLayerByAgentLayerId.get(layer.id);

    // Delegate usesGraphInteraction/coordOffset/originMode to registry
    const usesGraphInteraction = linkedEdgeLayer
      ? true
      : getUsesGraphInteraction(layer, registry);
    const coordOffset = usesGraphInteraction ? 'float' : getCoordOffset(layer, registry);
    const originMode = usesGraphInteraction ? 'center' : getOriginMode(layer, registry);
    const layerSceneBounds = usesGraphInteraction ? undefined : getSceneBoundsFromMetadata(layer, registry) ?? sceneBounds;
    const zIndex = getLayerZIndex(layer, registry) ?? implicitAgentLayerZIndex++;

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

  const allLayers: RenderLayerPlan[] = [
    ...backgroundLayers,
    ...gridLayers,
    ...edgeLayers,
    ...trajectoryLayers,
    ...agentLayers,
    ...genericLayers,
  ];

  const rolesInPlan = new Set(allLayers.map((layer) => layer.role));
  const roleOrder = buildRoleOrder(rolesInPlan, registry);
  const layersByRole = new Map<string, RenderLayerPlan[]>();
  for (const layer of allLayers) {
    const byRole = layersByRole.get(layer.role);
    if (byRole) {
      byRole.push(layer);
    } else {
      layersByRole.set(layer.role, [layer]);
    }
  }

  const orderedLayers: RenderLayerPlan[] = [];
  for (const role of roleOrder) {
    const byRole = layersByRole.get(role);
    if (byRole) {
      orderedLayers.push(...byRole);
      layersByRole.delete(role);
    }
  }
  for (const byRole of layersByRole.values()) {
    orderedLayers.push(...byRole);
  }

  return {
    environmentId: environment.id,
    buildKey: getRenderBuildKey(environment),
    sceneBounds,
    fitPadding,
    layers: orderedLayers,
    backgroundLayers,
    gridLayers,
    edgeLayers,
    trajectoryLayers,
    agentLayers,
    genericLayers,
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