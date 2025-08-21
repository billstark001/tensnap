import React from 'react';
import { GridEnvironmentView } from './GridEnvironmentView';
import { GraphEnvironmentView } from './GraphEnvironment';
import { ParameterControls } from './ParameterControls';
import { ChartView } from './ChartView';
import { useScenarioStore } from '../store/scenario';
import { AnchoredView } from '../types/ui';

export interface AnchoredViewRendererProps {
  type: AnchoredView['type'];
  id: string;
}

export const AnchoredViewRenderer: React.FC<AnchoredViewRendererProps> = ({ type, id }) => {
  const { environments, parameters, charts } = useScenarioStore();

  switch (type) {
    case 'environment': {
      const environment = environments.find(env => env.id.toString() === id);
      if (!environment) return <div>Environment not found: {id}</div>;
      
      if (environment.type === 'grid') {
        return <GridEnvironmentView environment={environment} />;
      } else {
        return <GraphEnvironmentView environment={environment} />;
      }
    }
    
    case 'parameter': {
      const parameter = parameters.find(param => param.id === id);
      if (!parameter) return <div>Parameter not found: {id}</div>;
      
      return <ParameterControls parameters={[parameter]} />;
    }
    
    case 'chart': {
      const chart = charts.find(c => c.id === id);
      if (!chart) return <div>Chart not found: {id}</div>;
      
      return <ChartView charts={[chart]} />;
    }
    
    default:
      return <div>Unknown view type: {type}</div>;
  }
};
