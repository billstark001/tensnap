import type {
  Action,
  ChartMetadata,
  MonitorMetadata,
  Parameter,
  ScenarioEnvironmentType,
  StateSyncRequest,
} from '@tensnap/protocol';
import type { MonitorState } from '../monitor';
import type { ScenarioSnapshot } from './types';

/** Definitions advertised during state sync; excludes simulation state and chart values. */
export type StateSyncInventory = Pick<
  StateSyncRequest,
  'parameters' | 'actions' | 'envs' | 'charts' | 'monitors'
>;

/** Build a wire request from definition lists without accepting identity fields from callers. */
export function createStateSyncRequest(
  modelId: string,
  requestId: string,
  instanceId: string | undefined,
  inventory: StateSyncInventory,
): StateSyncRequest {
  // The returned protocol message may outlive either a live Scenario or a
  // saved project's inventory. Keep ownership at this wire boundary.
  const { parameters, actions, envs, charts, monitors } = structuredClone(inventory);
  return {
    request_id: requestId,
    model_id: modelId,
    ...(instanceId === undefined ? {} : { instance_id: instanceId }),
    parameters,
    actions,
    envs,
    charts,
    monitors,
  };
}

interface InventoryEnvironment {
  id: string;
  type: ScenarioEnvironmentType;
  layers: Iterable<{ id: string; layerType: string }>;
}

interface StateSyncInventorySource {
  parameters: Iterable<Parameter>;
  actions: Iterable<Action>;
  environments: Iterable<InventoryEnvironment>;
  charts: Iterable<ChartMetadata>;
  monitors: Iterable<MonitorMetadata | MonitorState>;
}

/** Keep live Scenario and persisted project inventories on one projection path. */
export function createStateSyncInventory(source: StateSyncInventorySource): StateSyncInventory {
  const charts: ChartMetadata[] = [];
  const chartIds = new Set<string>();
  for (const chart of source.charts) {
    if (chartIds.has(chart.id)) continue;
    chartIds.add(chart.id);
    charts.push(chart);
  }
  return {
    parameters: [...source.parameters],
    actions: [...source.actions],
    envs: [...source.environments].map((environment) => ({
      id: environment.id,
      type: environment.type,
      layers: [...environment.layers].map((layer) => ({
        layer_id: layer.id,
        layer_type: layer.layerType,
      })),
    })),
    charts,
    monitors: [...source.monitors].map(({ id, label, render_hint }) => ({
      id,
      label,
      ...(render_hint === undefined ? {} : { render_hint }),
    })),
  };
}

/** Extract the advertised definitions from a saved scenario; an absent snapshot means an empty inventory. */
export function createStateSyncInventoryFromSnapshot(
  snapshot?: ScenarioSnapshot,
): StateSyncInventory {
  return createStateSyncInventory({
    parameters: snapshot?.parameters ?? [],
    actions: snapshot?.actions ?? [],
    environments: snapshot?.environments ?? [],
    charts: snapshot?.charts.flatMap((group) => Object.values(group.metadataDict)) ?? [],
    monitors: snapshot?.monitors ?? [],
  });
}
