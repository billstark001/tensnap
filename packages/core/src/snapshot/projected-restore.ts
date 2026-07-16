import {
  AgentItemSchema,
  EdgeItemSchema,
  ItemSchema,
  ProtocolRecordSchema,
  ProtocolValueSchema,
  RestorableEnvironmentSchema,
  TrajectoryItemSchema,
  type ProtocolData,
  type RestorableEnvironment,
} from '@tensnap/protocol';
import type { Scenario, ScenarioLayerSnapshot, ScenarioSnapshot } from '../scenario';

export interface ProjectedRestoreState {
  time?: number;
  parameters: Array<{ id: string; value: ProtocolData }>;
  envs: RestorableEnvironment[];
}

type ProjectedItem = Record<string, ProtocolData>;

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('A layer snapshot has an invalid storage shape.');
  }
  return value as Record<string, unknown>;
}

function itemKeyPart(value: string | number): string {
  return `${typeof value}:${String(value)}`;
}

function parseProjectedItem(layer: ScenarioLayerSnapshot, item: unknown, index: number): { item: ProjectedItem; key: string } {
  const portable = ItemSchema.safeParse(item);
  if (!portable.success) throw new Error(`Layer ${layer.id} has a non-protocol item at index ${index}.`);

  switch (layer.layerType) {
    case 'agent': {
      const parsed = AgentItemSchema.safeParse(portable.data);
      if (!parsed.success) throw new Error(`Agent layer ${layer.id} has an invalid item at index ${index}.`);
      return { item: portable.data, key: `id:${itemKeyPart(parsed.data.id)}` };
    }
    case 'edge': {
      const parsed = EdgeItemSchema.safeParse(portable.data);
      if (!parsed.success) throw new Error(`Edge layer ${layer.id} has an invalid item at index ${index}.`);
      return {
        item: portable.data,
        key: `edge:${itemKeyPart(parsed.data.source)}\u0000${itemKeyPart(parsed.data.target)}`,
      };
    }
    case 'trajectory': {
      const parsed = TrajectoryItemSchema.safeParse(portable.data);
      if (!parsed.success) throw new Error(`Trajectory layer ${layer.id} has an invalid item at index ${index}.`);
      return { item: portable.data, key: `id:${itemKeyPart(parsed.data.id)}` };
    }
    default:
      throw new Error(`Layer ${layer.id} (${layer.layerType}) cannot be projected for restore.`);
  }
}

function projectItems(layer: ScenarioLayerSnapshot): ProjectedItem[] | undefined {
  if (layer.layerType === 'grid' || layer.layerType === 'background') return undefined;
  const storage = asRecord(layer.storageSnapshot);
  const source = layer.layerType === 'agent'
    ? storage.agents
    : layer.layerType === 'edge'
      ? storage.edges
      : layer.layerType === 'trajectory'
        ? storage.configs
        : undefined;
  if (!Array.isArray(source)) {
    throw new Error(`Layer ${layer.id} (${layer.layerType}) cannot be projected for restore.`);
  }
  const keys = new Set<string>();
  return source.map((item, index) => {
    const projected = parseProjectedItem(layer, item, index);
    if (keys.has(projected.key)) {
      throw new Error(`Layer ${layer.id} has a duplicate item key at index ${index}.`);
    }
    keys.add(projected.key);
    return projected.item;
  });
}

function validateLayerTopology(environmentId: string, layers: readonly ScenarioLayerSnapshot[]): void {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  for (const layer of layers) {
    const dependencies = layer.dependencyLayerIds;
    const keys = Object.keys(dependencies);
    if (layer.layerType === 'edge' || layer.layerType === 'trajectory') {
      if (keys.length !== 1 || typeof dependencies.agent !== 'string') {
        throw new Error(`Layer ${layer.id} in environment ${environmentId} must depend on exactly one agent layer.`);
      }
      const agentLayer = byId.get(dependencies.agent);
      if (!agentLayer || agentLayer.layerType !== 'agent') {
        throw new Error(`Layer ${layer.id} in environment ${environmentId} depends on a missing or non-agent layer.`);
      }
      continue;
    }
    if (keys.length > 0) {
      throw new Error(`Layer ${layer.id} in environment ${environmentId} must not declare dependencies.`);
    }
  }
}

function hasSameDependencies(
  expected: Readonly<Record<string, string>> | undefined,
  actual: Readonly<Record<string, string>> | undefined,
): boolean {
  const expectedKeys = Object.keys(expected ?? {});
  const actualKeys = Object.keys(actual ?? {});
  return expectedKeys.length === actualKeys.length
    && expectedKeys.every((key) => actual?.[key] === expected?.[key]);
}

/** Whether a projected restore would add, remove, or rewire an environment layer. */
export function projectedRestoreChangesTopology(
  scenario: Scenario,
  environments: readonly RestorableEnvironment[],
): boolean {
  if (scenario.environments.size !== environments.length) return true;

  const environmentIds = new Set<string>();
  for (const environment of environments) {
    if (environmentIds.has(environment.id)) return true;
    environmentIds.add(environment.id);

    const currentEnvironment = scenario.getEnvironment(environment.id);
    if (!currentEnvironment
      || currentEnvironment.type !== environment.type
      || currentEnvironment.layers.size !== environment.layers.length) {
      return true;
    }

    const layerIds = new Set<string>();
    for (const layer of environment.layers) {
      if (layerIds.has(layer.layer_id)) return true;
      layerIds.add(layer.layer_id);

      const currentLayer = currentEnvironment.layers.get(layer.layer_id);
      if (!currentLayer
        || currentLayer.layerType !== layer.layer_type
        || !hasSameDependencies(layer.dependency_layer_ids, currentLayer.dependencyLayerIds)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Converts a renderer snapshot into the transport-neutral projected restore
 * shape. Renderer-only state (chart history, monitor values, trajectory point
 * history) never crosses the wire. Unknown/custom storage has no stable item exporter,
 * so it is rejected instead of silently dropping topology or state.
 */
export function projectSnapshotForRestore(snapshot: ScenarioSnapshot): ProjectedRestoreState {
  const parameterIds = new Set<string>();
  const parameters = snapshot.parameters.map((parameter) => {
    if (parameterIds.has(parameter.id)) throw new Error(`Duplicate parameter id in snapshot: ${parameter.id}.`);
    parameterIds.add(parameter.id);
    const value = ProtocolValueSchema.safeParse(parameter.value);
    if (!value.success) throw new Error(`Parameter ${parameter.id} has a non-protocol value.`);
    return { id: parameter.id, value: value.data };
  });

  const environmentIds = new Set<string>();
  const envs = snapshot.environments.map((environment) => {
    if (environmentIds.has(environment.id)) throw new Error(`Duplicate environment id in snapshot: ${environment.id}.`);
    environmentIds.add(environment.id);
    const layerIds = new Set<string>();
    for (const layer of environment.layers) {
      if (layerIds.has(layer.id)) throw new Error(`Duplicate layer id in environment ${environment.id}: ${layer.id}.`);
      layerIds.add(layer.id);
    }
    validateLayerTopology(environment.id, environment.layers);

    const layers = environment.layers.map((layer) => {
      const metadata = ProtocolRecordSchema.safeParse(layer.metadata);
      if (!metadata.success) throw new Error(`Layer ${layer.id} has non-protocol metadata.`);
      const items = projectItems(layer);
      return {
        layer_id: layer.id,
        layer_type: layer.layerType,
        dependency_layer_ids: Object.keys(layer.dependencyLayerIds).length ? structuredClone(layer.dependencyLayerIds) : undefined,
        metadata: metadata.data,
        items,
      };
    });
    return RestorableEnvironmentSchema.parse({ id: environment.id, type: environment.type, layers });
  });

  const time = typeof snapshot.metadata.time === 'number' && Number.isFinite(snapshot.metadata.time)
    ? snapshot.metadata.time
    : undefined;
  return { time, parameters, envs };
}
