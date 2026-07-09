import type { ScenarioDefinition } from '../scenario';
import { defineScenario } from './define';
import { defineLifecycleActions } from './lifecycle';
import type {
  BoundModelDefinition,
} from './types';
import { resolveMaybeFactory } from './utils';

export function buildScenarioDefinition<TConfig extends object, TModel>(
  binding: BoundModelDefinition<TConfig, TModel>,
  model: TModel,
  config: TConfig,
): ScenarioDefinition {
  return defineScenario({
    parameters: binding.parameters.map((parameter) => parameter.metadata(model, config)),
    actions: [
      ...defineLifecycleActions(binding.lifecycleLabels),
      ...binding.actions.map((action) => action.metadata),
    ],
    environments: binding.environments.map((environment) => ({
      id: environment.id,
      type: environment.type,
      layers: environment.layers.map((layer) => ({
        layerId: layer.id,
        layerType: layer.type,
        dependencyLayerIds: layer.dependencyLayerIds,
        data: resolveMaybeFactory(layer.data, model),
      })),
    })),
    charts: binding.charts.map((chart) => chart.metadata()),
  });
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
