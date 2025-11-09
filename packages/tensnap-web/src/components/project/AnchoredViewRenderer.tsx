import React from 'react';
import { GridEnvironmentView } from '../scenario/GridEnvironmentView';
import { GraphEnvironmentView } from '../scenario/GraphEnvironmentView';
import { UniformEnvironmentView } from '../scenario/UniformEnvironmentView';
import { ParameterControl } from './ParameterControl';
import { ChartView } from '../scenario/ChartView';
import { ScenarioStore, useScenarioStore } from '../../store/scenario/store';
import { AnchoredView } from '../../types/ui';
import { InstantiatedGraphEnvironment, InstantiatedGridEnvironment, InstantiatedUniformEnvironment } from '@/store/scenario/environment';
import { EnvironmentId } from '@/types/model';
import { useToast } from '@/store/toast';

export interface AnchoredViewRendererProps {
  type: AnchoredView['type'];
  id: string;
}

const AnchoredEnvironmentView = ({ id }: { id: EnvironmentId }) => {
  const isInTimeStep = useScenarioStore((store) => store.isInTimeStep); // subscribe to time step changes
  const currentTime = useScenarioStore((store) => store.currentTime) ?? -1;

  const environments = useScenarioStore((store) => store.environments) ?? new Map() as ScenarioStore['environments'];
  const environment = environments.get(id);
  if (!environment) return <div>Environment not found: {id}</div>;


  if (environment.type === 'grid') {
    const agentCount = Object.keys(environment?.agents ?? {}).length;
    const updateTrigger = (isInTimeStep ? -currentTime - 2 : currentTime + 2) + (agentCount << 20);
    return <GridEnvironmentView environment={environment as InstantiatedGridEnvironment} updateTrigger={updateTrigger} />;
  } else if (environment.type === 'graph') {
    return <GraphEnvironmentView environment={environment as InstantiatedGraphEnvironment} />;
  } else if (environment.type === 'uniform') {
    return <UniformEnvironmentView environment={environment as InstantiatedUniformEnvironment} />;
  } else {
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
  const chartGroup = charts?.allChartGroups.get(id);
  if (!chartGroup) return <div>Chart not found: {id}</div>;

  return <ChartView chartGroup={chartGroup} />;
}

export const AnchoredViewRenderer: React.FC<AnchoredViewRendererProps> = ({ type, id }) => {

  const toast = useToast();
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

    default: {
      toast.warning('Unknown view type', `Type: ${type}, ID: ${id}`);
      return <div>Unknown view type: {type}</div>;
    }
  }
};
