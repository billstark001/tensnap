import { ChartGroup, ChartGroupMetadata, ChartMetadata, Environment, EnvironmentId, Parameter } from "../types/model"
import { InstantiatedEnvironment, instantiateEnvironment } from "./environment";
import { instantiateChartMetadata, InstantiatedChartStorage } from "./chart";
import { sanitizeParameter } from "./parameter";
import { SetDataPayload } from "./core-types";


export type ParsedScenarioContent = {
  environments: Environment[];
  charts: ChartGroup[];
  parameters: Parameter[];
};

export type InstantiatedScenarioContent = {
  environments: Map<EnvironmentId, InstantiatedEnvironment>;
  charts: InstantiatedChartStorage;
  parameters: Map<string, Parameter>;
};

export function instantiateScenarioContent(parsed: ParsedScenarioContent): InstantiatedScenarioContent {
  const { environments, charts, parameters } = parsed;
  const instantiatedEnvironments: Map<EnvironmentId, InstantiatedEnvironment> = new Map();
  for (const env of environments) {
    instantiatedEnvironments.set(env.id, instantiateEnvironment(env));
  }

  const instantiatedParameters = new Map<string, Parameter>();
  for (const param of parameters) {
    instantiatedParameters.set(param.id, sanitizeParameter(param, false));
  }

  const instantiatedCharts = new InstantiatedChartStorage(charts);

  return {
    environments: instantiatedEnvironments,
    charts: instantiatedCharts,
    parameters: instantiatedParameters,
  };
}

export function mergeEnvironments(
  current: Map<string, InstantiatedEnvironment>,
  data: SetDataPayload,
  preserveExisting: boolean
): Map<string, InstantiatedEnvironment> {
  if (data.environments === undefined && data.removedEnvironmentIds === undefined) {
    return current;
  }

  if (preserveExisting) {
    const newEnvironments = new Map(current);
    for (const env of data.environments || []) {
      newEnvironments.set(env.id, instantiateEnvironment(env));
    }
    return newEnvironments;
  }

  return new Map(data.environments?.map(env => [env.id, instantiateEnvironment(env)]));
}

export function mergeParameters(
  current: Map<string, Parameter>,
  data: SetDataPayload,
  preserveExisting: boolean
): Map<string, Parameter> {
  if (data.parameters === undefined && data.removedParameterIds === undefined) {
    return current;
  }

  const newParameters = preserveExisting ? new Map(current) : new Map<string, Parameter>();
  const remaining = new Map(data.parameters?.map(param => [param.id, param]));
  const removedIds = new Set(data.removedParameterIds || []);

  for (const oldParam of newParameters.values()) {
    if (preserveExisting || !removedIds.has(oldParam.id)) {
      const mightBeNew = remaining.get(oldParam.id);
      if (mightBeNew) {
        newParameters.set(oldParam.id, sanitizeParameter({ ...oldParam, ...mightBeNew }, true));
        remaining.delete(oldParam.id);
      } else {
        newParameters.set(oldParam.id, sanitizeParameter(oldParam, false));
      }
    }
  }

  for (const [, param] of remaining) {
    newParameters.set(param.id, sanitizeParameter(param, false));
  }

  return newParameters;
}

export function mergeCharts(
  current: InstantiatedChartStorage,
  data: SetDataPayload,
  preserveExisting: boolean
): InstantiatedChartStorage {
  if (data.charts === undefined && data.removedChartIds === undefined && data.clearCharts === undefined) {
    return current;
  }

  const newCharts = preserveExisting ? current.shallowCopy() : new InstantiatedChartStorage([]);
  const removedChartIdsSet = new Set(data.removedChartIds || []);
  const clearAllCharts = data.clearCharts === true;
  const clearChartIdsSet = new Set<string>(
    clearAllCharts ? [] : (Array.isArray(data.clearCharts) ? data.clearCharts : [])
  );

  const chartGroupMetadata: ChartGroupMetadata[] = [];
  const chartMetadata: ChartMetadata[] = [];

  for (const chartMeta of data.charts || []) {
    (chartMeta.dataList?.length ? chartGroupMetadata : chartMetadata).push(chartMeta);
  }

  if (!preserveExisting) {
    for (const chartId of removedChartIdsSet) {
      newCharts.removeChartGroup(chartId) || newCharts.removeChartMetadata(chartId);
    }
  }

  for (const chartGroupMeta of chartGroupMetadata) {
    newCharts.addChartGroup(instantiateChartMetadata(chartGroupMeta), true);
  }

  for (const chartMeta of chartMetadata) {
    newCharts.upsertChartMetadata(chartMeta);
  }

  if (clearAllCharts) {
    newCharts.clearAll();
  } else if (clearChartIdsSet.size > 0) {
    const clearedGroupIds = newCharts.clearByGroup(Array.from(clearChartIdsSet));
    clearedGroupIds.forEach(id => clearChartIdsSet.delete(id));
    newCharts.clearByMetadata(Array.from(clearChartIdsSet));
  }

  return newCharts;
}