import type {
  Action,
  ChartGroupMetadata,
  MonitorMetadata,
  Parameter,
} from '@tensnap/protocol';
import type {
  ScenarioDefinition,
  ScenarioEnvironmentDefinition,
  ScenarioLayerDefinition,
} from '../scenario';
import { cloneChartGroupMetadata, cloneLayerDefinition } from '../scenario/definitionHelpers';
import { orderLayers } from '../scenario/layerTopology';

export function defineLayer<TLayer extends ScenarioLayerDefinition>(layer: TLayer): TLayer {
  return cloneLayerDefinition(layer);
}

export function defineEnvironment<TEnvironment extends ScenarioEnvironmentDefinition>(
  environment: TEnvironment,
): TEnvironment {
  const layers = environment.layers?.map((layer) => defineLayer(layer));
  return {
    ...environment,
    layers: layers && orderLayers(environment.id, layers,
      (layer) => layer.layerId, (layer) => layer.layerType,
      (layer) => layer.dependencyLayerIds),
  };
}

export function defineParameters<const TParameters extends readonly Parameter[]>(
  ...parameters: TParameters
): TParameters {
  return parameters.map((parameter) => ({ ...parameter })) as unknown as TParameters;
}

export function defineActions<const TActions extends readonly Action[]>(
  ...actions: TActions
): TActions {
  return actions.map((action) => ({ ...action })) as unknown as TActions;
}

export function defineCharts<const TCharts extends readonly ChartGroupMetadata[]>(
  ...charts: TCharts
): TCharts {
  return charts.map(cloneChartGroupMetadata) as unknown as TCharts;
}

export function defineMonitors<const TMonitors extends readonly MonitorMetadata[]>(
  ...monitors: TMonitors
): TMonitors {
  return monitors.map((monitor) => ({ ...monitor })) as unknown as TMonitors;
}

export function defineScenario<TScenario extends ScenarioDefinition>(
  definition: TScenario,
): TScenario {
  return {
    ...definition,
    parameters: definition.parameters?.map((parameter) => ({ ...parameter })),
    actions: definition.actions?.map((action) => ({ ...action })),
    environments: definition.environments?.map((environment) => defineEnvironment(environment)),
    charts: definition.charts?.map(cloneChartGroupMetadata),
    monitors: definition.monitors?.map((monitor) => ({ ...monitor })),
  };
}
