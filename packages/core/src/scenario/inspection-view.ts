import { AgentStorage, EdgeStorage, TrajectoryStorage, getCoordOffsetValue } from '../environment';
import type { AgentId } from '@tensnap/protocol/layers';
import type { Scenario } from './Scenario';
import type { LiveAgentInspection } from './ScenarioInspector';
import type { ScenarioSnapshot, ScenarioLayerSnapshot } from './types';

export interface AgentInspectionView {
  inspection: LiveAgentInspection;
  /** Current referenced metadata, including resources whose bytes are still pending. */
  assetHashes: Record<string, string>;
  /** Only the inspected environment, visible agents, their edges/traces and referenced assets. */
  scene: ScenarioSnapshot;
}

/** Build a small owned rendering projection without ever dumping the full Scenario. */
export function createAgentInspectionView(
  scenario: Scenario,
  inspection: LiveAgentInspection,
  heldAssets: ReadonlyMap<string, string> = new Map(),
): AgentInspectionView {
  const environment = scenario.getEnvironment(inspection.environmentId)!;
  const selected = new Map<string, Set<AgentId>>();
  const assets = new Set<string>();
  const layers: ScenarioLayerSnapshot[] = [];
  const viewport = inspection.kind === 'none' ? undefined : inspection.viewport;
  for (const layer of environment.layers.values()) {
    if (!(layer.storage instanceof AgentStorage)) continue;
    let agents;
    if (inspection.kind === 'graph') {
      if (layer.id !== inspection.layerId) continue;
      agents = [inspection.agent, ...inspection.neighbors];
    } else if (viewport) {
      const offset = getCoordOffsetValue(layer.metadata.coord_offset === 'float' ? 'float' : 'int');
      const centerX = viewport.x + viewport.width / 2 - offset;
      const centerY = viewport.y + viewport.height / 2 - offset;
      agents = layer.storage
        .getAgentsWithinRadius(centerX, centerY, Math.hypot(viewport.width, viewport.height) / 2)
        .filter(
          (agent) =>
            Number.isFinite(agent.x) &&
            Number.isFinite(agent.y) &&
            agent.x! + offset >= viewport.x &&
            agent.x! + offset <= viewport.x + viewport.width &&
            agent.y! + offset >= viewport.y &&
            agent.y! + offset <= viewport.y + viewport.height,
        );
    } else agents = layer.id === inspection.layerId ? [inspection.agent] : [];
    selected.set(layer.id, new Set(agents.map((agent) => agent.id)));
    for (const agent of agents)
      if (agent.icon?.startsWith('asset:')) assets.add(agent.icon.slice(6));
    layers.push({
      id: layer.id,
      layerType: layer.layerType,
      metadata: structuredClone(layer.metadata),
      dependencyLayerIds: { ...layer.dependencyLayerIds },
      storageSnapshot: { agents: structuredClone(agents) },
    });
  }
  for (const layer of environment.layers.values()) {
    if (layer.storage instanceof AgentStorage) continue;
    const ids = selected.get(layer.dependencyLayerIds.agent);
    let storageSnapshot: unknown;
    if (layer.storage instanceof EdgeStorage) {
      if (!ids) continue;
      const id = (value: any): AgentId => (typeof value === 'object' ? value.id : value);
      storageSnapshot = {
        edges: layer.storage
          .getEdgesForAgents(ids)
          .filter((edge) => ids.has(id(edge.source)) && ids.has(id(edge.target)))
          .map((edge) => ({
            ...structuredClone(edge),
            source: id(edge.source),
            target: id(edge.target),
          })),
      };
    } else if (layer.storage instanceof TrajectoryStorage) {
      if (!ids) continue;
      const data = layer.storage.getData();
      storageSnapshot = {
        config: { ...data.config },
        configs: [...ids].flatMap((id) => {
          const config = data.configs.get(id);
          return config ? [structuredClone(config)] : [];
        }),
        trajectories: [...ids].flatMap((id) => {
          const entry =
            layer.storage instanceof TrajectoryStorage ? layer.storage.getEntry(id) : undefined;
          if (!entry) return [];
          const segments = entry.segments.map((segment) =>
            Array.from(segment, (point) => ({
              ...point,
              color: point.color ?? entry.defaultColor,
            })),
          );
          return [
            {
              id,
              points: segments.flat(),
              ...(segments.length > 1 ? { segments } : {}),
              ...(entry.closed ? { closed: true } : {}),
            },
          ];
        }),
      };
    } else if (layer.layerType === 'grid' || layer.layerType === 'background') {
      storageSnapshot = layer.storage.dump();
      const background = layer.metadata.background as { asset_id?: string } | undefined;
      if (background?.asset_id) assets.add(background.asset_id);
    } else continue;
    layers.push({
      id: layer.id,
      layerType: layer.layerType,
      metadata: structuredClone(layer.metadata),
      dependencyLayerIds: { ...layer.dependencyLayerIds },
      storageSnapshot: structuredClone(storageSnapshot),
    });
  }
  const scene: ScenarioSnapshot = {
    metadata: {},
    actions: [],
    parameters: [],
    charts: [],
    monitors: [],
    logs: [],
    environments: [{ id: environment.id, type: environment.type, layers }],
    assets: [...assets].flatMap((id) => {
      const meta = scenario.assets.getMeta(id);
      if (!meta || heldAssets.get(id) === meta.hash) return [];
      const source = scenario.assets.get(id)?.source;
      const data = typeof source === 'string' ? new TextEncoder().encode(source) : source;
      return [{ meta: { ...meta }, ...(data ? { data: data.slice() } : {}) }];
    }),
  };
  const assetHashes = Object.fromEntries(
    [...assets].flatMap((id) => {
      const meta = scenario.assets.getMeta(id);
      return meta ? [[id, meta.hash]] : [];
    }),
  );
  return { inspection, scene, assetHashes };
}
