import type { ScenarioDefinition } from '../scenario';
import { cloneChartGroupMetadata } from '../scenario/definitionHelpers';
import { markCompiledTopology, orderLayers } from '../scenario/layerTopology';
import { defineLifecycleActions } from './lifecycle';
import type { BoundModelDefinition } from './types';
import { resolveMaybeFactory } from './utils';

// Bound model topology is static. Cache only layer indices, leaving dynamic
// metadata and parameter values to be rebuilt on each step.
type CompiledLayer = {
  index: number;
  id: string;
  type: string;
  dependencyLayerIds: Record<string, string>;
};
const topologyOrder = new WeakMap<object, CompiledLayer[][]>();

function layerOrder<TConfig extends object, TModel>(
  binding: BoundModelDefinition<TConfig, TModel>,
): CompiledLayer[][] {
  const cached = topologyOrder.get(binding);
  if (cached) return cached;
  const ordered = binding.environments.map((environment) => {
    const layers = environment.layers.map((layer, index) => ({
      index,
      id: layer.id,
      type: layer.type,
      dependencyLayerIds: { ...(layer.dependencyLayerIds ?? {}) },
    }));
    return orderLayers(
      environment.id,
      layers,
      (layer) => layer.id,
      (layer) => layer.type,
      (layer) => layer.dependencyLayerIds,
    );
  });
  topologyOrder.set(binding, ordered);
  return ordered;
}

export function buildScenarioDefinition<TConfig extends object, TModel>(
  binding: BoundModelDefinition<TConfig, TModel>,
  model: TModel,
  config: TConfig,
): ScenarioDefinition {
  const ordered = layerOrder(binding);
  const definition: ScenarioDefinition = {
    parameters: binding.parameters.map((parameter) => ({ ...parameter.metadata(model, config) })),
    actions: [
      ...defineLifecycleActions(binding.lifecycleLabels),
      ...binding.actions.map((action) => ({ ...action.metadata })),
    ],
    environments: binding.environments.map((environment, environmentIndex) => ({
      id: environment.id,
      type: environment.type,
      layers: ordered[environmentIndex]!.map((compiled) => {
        const layer = environment.layers[compiled.index]!;
        return {
          layerId: compiled.id,
          layerType: compiled.type,
          dependencyLayerIds: compiled.dependencyLayerIds,
          metadata: { ...(resolveMaybeFactory(layer.metadata, model) ?? {}) },
        };
      }),
    })),
    charts: binding.charts.map((chart) => cloneChartGroupMetadata(chart.metadata())),
    monitors: binding.monitors.map((monitor) => ({ ...monitor.metadata() })),
  };
  markCompiledTopology(definition);
  return definition;
}

export function getCurrentConfig<TConfig extends object, TModel>(
  binding: BoundModelDefinition<TConfig, TModel>,
  model: TModel,
  initialConfig: TConfig,
): TConfig {
  return {
    ...initialConfig,
    ...(binding.options.getConfig?.(model, initialConfig) ?? {}),
  };
}
