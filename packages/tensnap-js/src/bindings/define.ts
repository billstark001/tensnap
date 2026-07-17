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

export function defineLayer<TLayer extends ScenarioLayerDefinition>(layer: TLayer): TLayer {
  return {
    ...layer,
    dependencyLayerIds: { ...(layer.dependencyLayerIds ?? {}) },
    metadata: { ...(layer.metadata ?? {}) },
  };
}

export function defineEnvironment<TEnvironment extends ScenarioEnvironmentDefinition>(
  environment: TEnvironment,
): TEnvironment {
  return {
    ...environment,
    layers: environment.layers?.map((layer) => defineLayer(layer)),
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
  return charts.map((chart) => ({
    ...chart,
    data_list: chart.data_list?.map((entry: NonNullable<ChartGroupMetadata['data_list']>[number]) => ({ ...entry })),
  })) as unknown as TCharts;
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
    charts: definition.charts?.map((chart) => ({
      ...chart,
      data_list: chart.data_list?.map((entry: NonNullable<ChartGroupMetadata['data_list']>[number]) => ({ ...entry })),
    })),
    monitors: definition.monitors?.map((monitor) => ({ ...monitor })),
  };
}
