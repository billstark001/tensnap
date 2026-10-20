import { EdgeStorage } from '../environment/storages/EdgeStorage';
import { AgentStorage } from '../environment/storages/AgentStorage';
import type { Scenario } from './Scenario';
import type { ScenarioLayerSnapshot, ScenarioSnapshot } from './types';

import {
  ScenarioQuerySchema,
  compileFieldPath,
  readField,
  type ScenarioQuery,
  type QueryLocation,
  type QueryItem,
  type ScenarioQueryResult,
} from './query-schema';

/** Execute synchronously against a single borrowed boundary; only the small result escapes. */
export function queryScenario(
  source: Scenario | ScenarioSnapshot,
  input: ScenarioQuery,
  location: QueryLocation,
): ScenarioQueryResult {
  const spec = ScenarioQuerySchema.parse(input);
  const binding = JSON.stringify([location, spec.selector, spec.fields]);
  let offset = 0;
  if (spec.cursor) {
    let cursor;
    try {
      cursor = JSON.parse(spec.cursor);
    } catch {
      throw new Error('Invalid query cursor.');
    }
    if (
      !Array.isArray(cursor) ||
      cursor.length !== 2 ||
      cursor[0] !== binding ||
      !Number.isSafeInteger(cursor[1]) ||
      cursor[1] < 0
    )
      throw new Error('Query cursor does not match this boundary/selector.');
    offset = cursor[1];
  }
  const live = !Array.isArray(source.environments);
  const scenario = source as Scenario;
  const snapshot = source as ScenarioSnapshot;
  const paths = spec.fields?.map(compileFieldPath);
  const items: QueryItem[] = [];
  let seen = 0;
  let more = false;
  const add = (ref: QueryItem['ref'], value: unknown): boolean => {
    if (seen++ < offset) return true;
    if (items.length >= spec.limit) {
      more = true;
      return false;
    }
    items.push({
      ref: structuredClone(ref),
      ...(paths
        ? {
            fields: paths.map((path) => {
              const selected = readField(value, path);
              return { path, ...structuredClone(selected) };
            }),
          }
        : { value: structuredClone(value) }),
    });
    return true;
  };
  const selected = spec.selector;
  if (selected.kind === 'cell') {
    const layer = live
      ? scenario.getEnvironment(selected.environmentId)?.layers.get(selected.layerId)
      : snapshot.environments
          .find((e) => e.id === selected.environmentId)
          ?.layers.find((l) => l.id === selected.layerId);
    // Cells are projected agent items with public x/y coordinates. Never decode an item's private ID.
    if (layer?.layerType === 'agent') {
      const agents =
        'storage' in layer && layer.storage instanceof AgentStorage
          ? layer.storage.agents.values()
          : (
              (layer as ScenarioLayerSnapshot).storageSnapshot as {
                agents: Array<{ id: string | number; x?: number; y?: number }>;
              }
            ).agents;
      for (const agent of agents)
        if (agent.x === selected.x && agent.y === selected.y)
          if (
            !add(
              {
                kind: 'agent',
                environmentId: selected.environmentId,
                layerId: selected.layerId,
                agentId: agent.id,
              },
              agent,
            )
          )
            break;
    }
  } else if (selected.kind === 'agent' || selected.kind === 'neighbors') {
    const { ref } = selected;
    const layer = live
      ? scenario.getEnvironment(ref.environmentId)?.layers.get(ref.layerId)
      : snapshot.environments
          .find((e) => e.id === ref.environmentId)
          ?.layers.find((l) => l.id === ref.layerId);
    const storage =
      live && layer && 'storage' in layer && layer.storage instanceof AgentStorage
        ? layer.storage
        : undefined;
    const agents =
      !live && layer && 'storageSnapshot' in layer
        ? ((
            layer.storageSnapshot as {
              agents?: Array<{ id: string | number; x?: number; y?: number }>;
            }
          ).agents ?? [])
        : [];
    const target = storage
      ? storage.getAgent(ref.agentId)
      : agents.find((a) => a.id === ref.agentId);
    if (target && selected.kind === 'agent') add({ kind: 'agent', ...ref }, target);
    if (target && selected.kind === 'neighbors') {
      const environment = live
        ? scenario.getEnvironment(ref.environmentId)
        : snapshot.environments.find((e) => e.id === ref.environmentId);
      const neighborIds = new Set<string | number>();
      let graph = false;
      if (environment)
        for (const dependency of environment.layers.values()) {
          if (
            dependency.layerType !== 'edge' ||
            dependency.dependencyLayerIds.agent !== ref.layerId
          )
            continue;
          graph = true;
          const edges =
            'storage' in dependency && dependency.storage instanceof EdgeStorage
              ? dependency.storage.getEdgesForAgent(ref.agentId)
              : (
                  (dependency as ScenarioLayerSnapshot).storageSnapshot as {
                    edges: Array<{ source: unknown; target: unknown }>;
                  }
                ).edges;
          const endpoint = (value: unknown) =>
            typeof value === 'object' && value !== null
              ? (value as { id: string | number }).id
              : (value as string | number);
          for (const edge of edges) {
            const sourceId = endpoint(edge.source),
              targetId = endpoint(edge.target);
            if (sourceId === ref.agentId) neighborIds.add(targetId);
            if (targetId === ref.agentId) neighborIds.add(sourceId);
          }
        }
      if (graph) {
        for (const agentId of neighborIds) {
          if (agentId === ref.agentId) continue;
          const agent = storage ? storage.getAgent(agentId) : agents.find((a) => a.id === agentId);
          if (agent && !add({ kind: 'agent', ...ref, agentId }, agent)) break;
        }
      } else {
        const positioned = target as { x?: number; y?: number };
        if (typeof positioned.x === 'number' && typeof positioned.y === 'number') {
          const candidates = storage ? storage.agents.values() : agents;
          for (const agent of candidates) {
            if (
              agent.id === ref.agentId ||
              typeof agent.x !== 'number' ||
              typeof agent.y !== 'number' ||
              Math.hypot(agent.x - positioned.x, agent.y - positioned.y) > selected.radius
            )
              continue;
            if (!add({ kind: 'agent', ...ref, agentId: agent.id }, agent)) break;
          }
        }
      }
    }
  } else if (selected.kind === 'layer') {
    const environment = live
      ? scenario.getEnvironment(selected.environmentId)
      : snapshot.environments.find((e) => e.id === selected.environmentId);
    if (environment)
      for (const layer of environment.layers.values()) {
        if (selected.layerId !== undefined && selected.layerId !== layer.id) continue;
        if (
          !add(
            { kind: 'layer', environmentId: selected.environmentId, layerId: layer.id },
            {
              id: layer.id,
              layerType: layer.layerType,
              metadata: layer.metadata,
              dependencyLayerIds: layer.dependencyLayerIds,
            },
          )
        )
          break;
      }
  } else if (selected.kind === 'metadata') {
    add({ kind: 'metadata' }, source.metadata);
  } else {
    const values =
      selected.kind === 'monitor'
        ? live
          ? selected.id === undefined
            ? scenario.monitors.all.values()
            : [scenario.monitors.getSnapshot(selected.id)].filter((value) => value !== undefined)
          : snapshot.monitors
        : selected.kind === 'parameter'
          ? live
            ? selected.id === undefined
              ? scenario.parameters.values()
              : [scenario.parameters.get(selected.id)].filter((value) => value !== undefined)
            : snapshot.parameters
          : live
            ? selected.id === undefined
              ? scenario.charts.getGroupList()
              : [scenario.charts.getGroup(selected.id)].filter((value) => value !== undefined)
            : snapshot.charts;
    for (const value of values) {
      if (selected.id !== undefined && selected.id !== value.id) continue;
      const projected =
        selected.kind === 'chart' && 'data' in value
          ? {
              id: value.id,
              label: value.label,
              metadataDict: value.metadataDict,
              latest: value.data[value.data.length - 1],
            }
          : value;
      if (!add({ kind: selected.kind, id: value.id }, projected)) break;
    }
  }
  return {
    version: 1,
    location: structuredClone(location),
    found: items.length > 0,
    count: items.length,
    items,
    truncated: more,
    ...(more ? { cursor: JSON.stringify([binding, offset + items.length]) } : {}),
  };
}
