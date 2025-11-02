import React from 'react';
import { GridEnvironmentView } from './modeling/GridEnvironmentView';
import { GraphEnvironmentView } from './modeling/GraphEnvironmentView';
import { ParameterControl } from './ParameterControl';
import { ChartView } from './modeling/ChartView';
import { ScenarioStore, useScenarioStore } from '../store/scenario';
import { AnchoredView } from '../types/ui';
import { InstantiatedGraphEnvironment, InstantiatedGridEnvironment } from '@/store/scenario-inst';
import { EnvironmentId } from '@/types/model';

export interface AnchoredViewRendererProps {
  type: AnchoredView['type'];
  id: string;
}

const AnchoredEnvironmentView = ({ id }: { id: EnvironmentId }) => {
  useScenarioStore((store) => store.isInTimeStep); // subscribe to time step changes

  const environments = useScenarioStore((store) => store.environments) ?? new Map() as ScenarioStore['environments'];
  const environment = environments.get(id);
  if (!environment) return <div>Environment not found: {id}</div>;

  if (environment.type === 'grid') {
    return <GridEnvironmentView environment={environment as InstantiatedGridEnvironment} />;
  } else if (environment.type === 'graph') {
    return <GraphEnvironmentView environment={environment as InstantiatedGraphEnvironment} />;
  } else {
    // TODO add uniform environment view
    return <div>Unsupported environment type: {environment.type}</div>;
  }
};

const AnchoredParameterView = ({ id }: { id: string }) => {
  const parameters = useScenarioStore((store) => store.parameters) ?? [];
  const parameter = parameters.find(param => param.id === id);
  if (!parameter) return <div>Parameter not found: {id}</div>;

  return <ParameterControl parameter={parameter} />;
};

const AnchoredChartView = ({ id }: { id: string }) => {
  useScenarioStore((store) => store.isInTimeStep); // subscribe to time step changes
  const charts = useScenarioStore((store) => store.charts);
  const chartGroup = charts?.chartDataMapByGroup.get(id);
  if (!chartGroup) return <div>Chart not found: {id}</div>;

  return <ChartView chartGroup={chartGroup} />;
}

export const AnchoredViewRenderer: React.FC<AnchoredViewRendererProps> = ({ type, id }) => {

  switch (type) {
    case 'environment': {
      return <AnchoredEnvironmentView id={id} />;
    }

    case 'parameter': {
      return <AnchoredParameterView id={id} />;

    }
    case 'chart': {
      return <AnchoredChartView id={id} />;
    }

    default:
      console.log(type, id);
      return <div>Unknown view type: {type}</div>;
  }
};
