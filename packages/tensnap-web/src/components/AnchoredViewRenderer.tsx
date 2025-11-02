import React from 'react';
import { GridEnvironmentView } from './modeling/GridEnvironmentView';
import { GraphEnvironmentView } from './modeling/GraphEnvironmentView';
import { ParameterControl } from './ParameterControl';
import { ChartView } from './modeling/ChartView';
import { ScenarioStore, useScenarioStore } from '../store/scenario';
import { AnchoredView } from '../types/ui';
import { InstantiatedGraphEnvironment, InstantiatedGridEnvironment } from '@/types/model-inst';

export interface AnchoredViewRendererProps {
  type: AnchoredView['type'];
  id: string;
}

export const AnchoredViewRenderer: React.FC<AnchoredViewRendererProps> = ({ type, id }) => {
  const { 
    environments = new Map() as ScenarioStore['environments'], 
    parameters = [], 
    charts = [] 
  } = useScenarioStore() ?? {};

  switch (type) {
    case 'environment': {
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
    }

    case 'parameter': {
      const parameter = parameters.find(param => param.id === id);
      if (!parameter) return <div>Parameter not found: {id}</div>;

      return <ParameterControl parameter={parameter} />;
    }

    case 'chart': {
      const chart = charts.find(c => c.id === id);
      if (!chart) return <div>Chart not found: {id}</div>;

      return <ChartView chart={chart} />;
    }

    default:
      return <div>Unknown view type: {type}</div>;
  }
};
