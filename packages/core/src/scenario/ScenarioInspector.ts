import type { AgentId } from '@tensnap/protocol/layers';
import type { AgentRenderState, GraphEdge, Viewport } from '../environment';
import { AgentStorage, EdgeStorage, getCoordOffsetValue } from '../environment';
import type {
  ScenarioEnvironmentSnapshot,
  ScenarioEnvironmentState,
  ScenarioLayerSnapshot,
  ScenarioSnapshot,
} from './types';
import type { Scenario } from './Scenario';

/** A stable reference to a renderer-owned agent, safe to keep in UI state. */
export interface AgentRef {
  environmentId: string;
  layerId: string;
  agentId: AgentId;
}

export interface AgentInspectionOptions {
  /** Radius in scene units for 2D neighbourhood inspection. */
  radius?: number;
}

export interface AgentInspectionBase {
  ref: AgentRef;
  /** Fresh copy resolved at inspection time; never an expiring storage reference. */
  agent: AgentRenderState;
  environmentId: string;
  layerId: string;
  radius: number;
  neighbors: AgentRenderState[];
  neighborCount: number;
  edges: GraphEdge[];
}

export interface SpatialAgentInspection extends AgentInspectionBase {
  kind: 'spatial';
  viewport: Viewport;
  /** A filtered, renderable scene containing backgrounds, grid, traces and neighbourhood. */
  renderSnapshot: ScenarioSnapshot;
}

export interface GraphAgentInspection extends AgentInspectionBase {
  kind: 'graph';
  /** Existing renderer positions only; this inspector never starts a force simulation. */
  viewport: Viewport | undefined;
  /** An ego graph snapshot rooted at `ref`. */
  renderSnapshot: ScenarioSnapshot;
}

/**
 * Browser-facing inspection result. It deliberately omits the serializable
 * scene snapshot because the browser can render the live Scenario storage
 * directly; rebuilding that snapshot for every tick is needlessly expensive.
 */
export interface LiveSpatialAgentInspection extends AgentInspectionBase {
  kind: 'spatial';
  viewport: Viewport;
}

export interface LiveGraphAgentInspection extends AgentInspectionBase {
  kind: 'graph';
  viewport: Viewport | undefined;
}

export interface NonSpatialAgentInspection extends AgentInspectionBase {
  kind: 'none';
  reason: 'uniform-environment' | 'agent-has-no-position';
}

export type AgentInspection = SpatialAgentInspection | GraphAgentInspection | NonSpatialAgentInspection;
export type LiveAgentInspection = LiveSpatialAgentInspection | LiveGraphAgentInspection | NonSpatialAgentInspection;

const DEFAULT_RADIUS = 3;
const MIN_VIEWPORT_EXTENT = 1;

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function isPositioned(agent: AgentRenderState): agent is AgentRenderState & { x: number; y: number } {
  return Number.isFinite(agent.x) && Number.isFinite(agent.y);
}

function resolveEdgeId(endpoint: GraphEdge['source']): AgentId {
  return typeof endpoint === 'object' && endpoint !== null
    ? endpoint.id
    : endpoint;
}

function collectEdgeStorages(environment: ScenarioEnvironmentState, agentLayerId: string): EdgeStorage[] {
  const result: EdgeStorage[] = [];
  for (const layer of environment.layers.values()) {
    if (layer.dependencyLayerIds.agent !== agentLayerId || !(layer.storage instanceof EdgeStorage)) {
      continue;
    }
    result.push(layer.storage);
  }
  return result;
}

function endpointIds(edge: GraphEdge): [AgentId, AgentId] {
  return [resolveEdgeId(edge.source), resolveEdgeId(edge.target)];
}

function isGraphEnvironment(environment: ScenarioEnvironmentState, agentLayerId: string): boolean {
  // An edge layer alone is not enough: a spatial 2D model may expose
  // relationships while retaining simulator-owned coordinates. The renderer
  // registry uses this metadata flag to opt into graph interaction semantics.
  return environment.layers.get(agentLayerId)?.metadata.uses_graph_interaction === true;
}

/** Match the agent layer's rendered scene coordinates, including grid centers. */
function getRenderedAgentOffset(environment: ScenarioEnvironmentState, agentLayerId: string): number {
  // render-plan promotes agent layers linked to an edge layer to graph mode,
  // where coordinates are already scene coordinates and must not receive +0.5.
  for (const layer of environment.layers.values()) {
    if (layer.dependencyLayerIds.agent === agentLayerId && layer.storage instanceof EdgeStorage) {
      return 0;
    }
  }
  const metadata = environment.layers.get(agentLayerId)?.metadata ?? {};
  return getCoordOffsetValue(metadata.coord_offset === 'float' ? 'float' : 'int');
}

function createViewport(center: { x: number; y: number }, radius: number, agentSize?: number): Viewport {
  // The semantic radius remains the requested neighbourhood radius. An
  // explicitly oversized marker needs extra visual room, otherwise the target
  // can fill the whole inspector canvas and obscure nearby agents.
  const markerPadding = Math.max(0, ((agentSize ?? 1) - 1) / 2);
  const extent = Math.max(MIN_VIEWPORT_EXTENT, (radius + markerPadding) * 2);
  return {
    x: center.x - extent / 2,
    y: center.y - extent / 2,
    width: extent,
    height: extent,
  };
}

function createEgoViewport(agents: AgentRenderState[], fallback: AgentRenderState): Viewport | undefined {
  const positioned = agents.filter(isPositioned);
  if (positioned.length === 0) {
    return isPositioned(fallback) ? createViewport(fallback, DEFAULT_RADIUS) : undefined;
  }
  let minX = positioned[0].x;
  let maxX = positioned[0].x;
  let minY = positioned[0].y;
  let maxY = positioned[0].y;
  for (const agent of positioned.slice(1)) {
    minX = Math.min(minX, agent.x);
    maxX = Math.max(maxX, agent.x);
    minY = Math.min(minY, agent.y);
    maxY = Math.max(maxY, agent.y);
  }
  const width = Math.max(MIN_VIEWPORT_EXTENT, maxX - minX);
  const height = Math.max(MIN_VIEWPORT_EXTENT, maxY - minY);
  const padding = Math.max(width, height) * 0.15;
  return { x: minX - padding, y: minY - padding, width: width + padding * 2, height: height + padding * 2 };
}

function filterSnapshot(
  snapshot: ScenarioSnapshot,
  environmentId: string,
  agentLayerId: string,
  agentIds: Set<AgentId>,
): ScenarioSnapshot {
  const environment = snapshot.environments.find((candidate) => candidate.id === environmentId);
  if (!environment) {
    return { ...snapshot, environments: [] };
  }

  const layers = environment.layers.map((layer): ScenarioLayerSnapshot => {
    const result = cloneValue(layer);
    if (layer.id === agentLayerId && layer.layerType === 'agent') {
      const storage = result.storageSnapshot as { agents?: AgentRenderState[] };
      if (Array.isArray(storage.agents)) {
        storage.agents = storage.agents.filter((agent) => agentIds.has(agent.id));
      }
      return result;
    }

    if (layer.dependencyLayerIds.agent !== agentLayerId) {
      return result;
    }

    if (layer.layerType === 'edge') {
      const storage = result.storageSnapshot as { edges?: GraphEdge[] };
      if (Array.isArray(storage.edges)) {
        storage.edges = storage.edges.filter((edge) => {
          const [source, target] = endpointIds(edge);
          return agentIds.has(source) && agentIds.has(target);
        });
      }
    }

    if (layer.layerType === 'trajectory') {
      const storage = result.storageSnapshot as {
        configs?: Array<{ id: AgentId }>;
        trajectories?: Array<{ id: AgentId }>;
      };
      if (Array.isArray(storage.configs)) {
        storage.configs = storage.configs.filter((config) => agentIds.has(config.id));
      }
      if (Array.isArray(storage.trajectories)) {
        storage.trajectories = storage.trajectories.filter((trajectory) => agentIds.has(trajectory.id));
      }
    }
    return result;
  });

  const filteredEnvironment: ScenarioEnvironmentSnapshot = { ...cloneValue(environment), layers };
  return { ...cloneValue(snapshot), environments: [filteredEnvironment] };
}

/**
 * Shared, read-only agent inspection semantics for browser UI and the agent
 * control API. Every call resolves the reference against the live Scenario so
 * an open inspector cannot accidentally retain an obsolete agent object.
 */
export class ScenarioInspector {
  constructor(private readonly scenario: Scenario) {}

  inspect(ref: AgentRef, options: AgentInspectionOptions = {}): AgentInspection | undefined {
    return this.inspectInternal(ref, options, true) as AgentInspection | undefined;
  }

  /**
   * Resolve fields, neighbours and viewport without cloning a render snapshot.
   * Use this on a frequently-updating browser inspector; the canvas can bind
   * to the live ScenarioEnvironmentState and receive storage deltas directly.
   */
  inspectLive(ref: AgentRef, options: AgentInspectionOptions = {}): LiveAgentInspection | undefined {
    return this.inspectInternal(ref, options, false) as LiveAgentInspection | undefined;
  }

  private inspectInternal(
    ref: AgentRef,
    options: AgentInspectionOptions,
    includeRenderSnapshot: boolean,
  ): AgentInspection | LiveAgentInspection | undefined {
    const environment = this.scenario.getEnvironment(ref.environmentId);
    const agentLayer = environment?.layers.get(ref.layerId);
    if (!environment || !agentLayer || !(agentLayer.storage instanceof AgentStorage)) {
      return undefined;
    }
    const agentStorage = agentLayer.storage;

    const liveAgent = agentStorage.getAgent(ref.agentId);
    if (!liveAgent) {
      return undefined;
    }

    const radius = Math.max(MIN_VIEWPORT_EXTENT / 2, options.radius ?? DEFAULT_RADIUS);
    const agent = cloneValue(liveAgent);
    const edgeStorages = collectEdgeStorages(environment, ref.layerId);
    const graph = isGraphEnvironment(environment, ref.layerId);

    if (graph) {
      const edges = edgeStorages.flatMap((storage) => storage.getEdgesForAgent(ref.agentId));
      const neighborIds = new Set<AgentId>();
      for (const edge of edges) {
        const [source, target] = endpointIds(edge);
        neighborIds.add(source === ref.agentId ? target : source);
      }
      const neighbors = [...neighborIds]
        .filter((id) => id !== ref.agentId)
        .map((id) => agentStorage.getAgent(id))
        .filter((candidate): candidate is AgentRenderState => candidate !== undefined)
        .map(cloneValue);
      const relevantIds = new Set<AgentId>([ref.agentId, ...neighbors.map((neighbor) => neighbor.id)]);
      const base: LiveGraphAgentInspection = {
        kind: 'graph',
        ref: { ...ref },
        agent,
        environmentId: environment.id,
        layerId: ref.layerId,
        radius,
        neighbors,
        neighborCount: neighbors.length,
        edges: edges.map(cloneValue),
        viewport: createEgoViewport([agent, ...neighbors], agent),
      };
      return includeRenderSnapshot
        ? { ...base, renderSnapshot: filterSnapshot(this.scenario.dump(), environment.id, ref.layerId, relevantIds) }
        : base;
    }

    if (environment.type === 'uniform') {
      return {
        kind: 'none',
        reason: 'uniform-environment',
        ref: { ...ref },
        agent,
        environmentId: environment.id,
        layerId: ref.layerId,
        radius,
        neighbors: [],
        neighborCount: 0,
        edges: [],
      };
    }

    if (!isPositioned(agent)) {
      return {
        kind: 'none',
        reason: 'agent-has-no-position',
        ref: { ...ref },
        agent,
        environmentId: environment.id,
        layerId: ref.layerId,
        radius,
        neighbors: [],
        neighborCount: 0,
        edges: [],
      };
    }

    const neighbors = agentStorage.getAgentsWithinRadius(agent.x, agent.y, radius)
      .filter((candidate) => candidate.id !== ref.agentId)
      .map(cloneValue);
    const relevantIds = new Set<AgentId>([ref.agentId, ...neighbors.map((neighbor) => neighbor.id)]);
    const edges = edgeStorages
      .flatMap((storage) => storage.getEdgesForAgents(relevantIds))
      .filter((edge) => {
        const [source, target] = endpointIds(edge);
        return relevantIds.has(source) && relevantIds.has(target);
      });
    const base: LiveSpatialAgentInspection = {
      kind: 'spatial',
      ref: { ...ref },
      agent,
      environmentId: environment.id,
      layerId: ref.layerId,
      radius,
      neighbors,
      neighborCount: neighbors.length,
      edges: edges.map(cloneValue),
      viewport: createViewport({
        x: agent.x + getRenderedAgentOffset(environment, ref.layerId),
        y: agent.y + getRenderedAgentOffset(environment, ref.layerId),
      }, radius, agent.size),
    };
    return includeRenderSnapshot
      ? { ...base, renderSnapshot: filterSnapshot(this.scenario.dump(), environment.id, ref.layerId, relevantIds) }
      : base;
  }
}
