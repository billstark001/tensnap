import type {
  Action,
  ChartGroupMetadata,
  Parameter,
} from '../core-types';
import type {
  ScenarioDefinition,
  ScenarioEnvironmentDefinition,
  ScenarioLayerDefinition,
} from '../scenario';

export function defineLayer<TLayer extends ScenarioLayerDefinition>(layer: TLayer): TLayer {
  return {
    ...layer,
    dependencyLayerIds: { ...(layer.dependencyLayerIds ?? {}) },
    data: { ...(layer.data ?? {}) },
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
    dataList: chart.dataList?.map((entry: NonNullable<ChartGroupMetadata['dataList']>[number]) => ({ ...entry })),
  })) as unknown as TCharts;
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
      dataList: chart.dataList?.map((entry: NonNullable<ChartGroupMetadata['dataList']>[number]) => ({ ...entry })),
    })),
  };
}
