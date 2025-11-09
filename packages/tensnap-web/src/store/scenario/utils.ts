import { ChartGroup, Environment, EnvironmentId, Parameter } from "@/types/model"
import { InstantiatedEnvironment, instantiateEnvironment } from "./environment";
import { InstantiatedChartStorage } from "./chart";
import { sanitizeParameter } from "./parameter";


export type ParsedScenarioContent = {
  environments: Environment[];
  charts: ChartGroup[];
  parameters: Parameter[];
};

export type InstantiatedScenarioContent = {
  environments: Map<EnvironmentId, InstantiatedEnvironment>;
  charts: InstantiatedChartStorage;
  parameters: Parameter[];
};

export function instantiateScenarioContent(parsed: ParsedScenarioContent): InstantiatedScenarioContent {
  const { environments, charts, parameters } = parsed;
  const instantiatedEnvironments: Map<EnvironmentId, InstantiatedEnvironment> = new Map();
  for (const env of environments) {
    instantiatedEnvironments.set(env.id, instantiateEnvironment(env));
  }

  const instantiatedParameters = parameters.map(p => sanitizeParameter(p, false));

  const instantiatedCharts = new InstantiatedChartStorage(charts);

  return {
    environments: instantiatedEnvironments,
    charts: instantiatedCharts,
    parameters: instantiatedParameters,
  };
}
