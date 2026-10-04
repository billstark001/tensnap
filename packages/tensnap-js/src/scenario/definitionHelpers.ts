import type { ChartGroupMetadata, EnvLayerCreatePayload, ProtocolData } from '@tensnap/protocol';
import type { ScenarioLayerDefinition } from './ScenarioRegistry';

export function cloneLayerDefinition<T extends ScenarioLayerDefinition>(layer: T): T {
  return {
    ...layer,
    dependencyLayerIds: { ...(layer.dependencyLayerIds ?? {}) },
    metadata: { ...(layer.metadata ?? {}) },
  };
}

export function cloneChartGroupMetadata<T extends ChartGroupMetadata>(chart: T): T {
  return {
    ...chart,
    data_list: chart.data_list?.map((entry) => ({ ...entry })),
  };
}

export function layerCreatePayload(
  envId: string,
  layer: ScenarioLayerDefinition,
): EnvLayerCreatePayload {
  return {
    env_id: envId,
    layer_id: layer.layerId,
    layer_type: layer.layerType,
    dependency_layer_ids: layer.dependencyLayerIds,
    metadata: layer.metadata as Record<string, ProtocolData> | undefined,
  };
}
