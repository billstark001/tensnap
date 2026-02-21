import { GridEnvironmentView } from '../scenario/GridEnvironmentView';
import { GraphEnvironmentView } from '../scenario/GraphEnvironmentView';
import { UniformEnvironmentView } from '../scenario/UniformEnvironmentView';
import { ParameterControl } from './ParameterControl';
import { ChartView } from '../scenario/ChartView';
import { ScenarioStore, useScenarioStore } from '../../store/scenario/store';
import { InstantiatedGraphEnvironment, InstantiatedGridEnvironment, InstantiatedUniformEnvironment } from '@/store/scenario/environment';
import { EnvironmentId } from '@/types/model';
import { useToast } from '@/store/toast';
import { AnchoredViewRendererType } from '../view/types';


const AnchoredEnvironmentView = ({ id }: { id: EnvironmentId }) => {

  const environments = useScenarioStore((store) => store.environments) ?? new Map() as ScenarioStore['environments'];
  const updateTrigger = useScenarioStore((store) => store.environmentUpdateTrigger.value);

  const environment = environments.get(id);
  if (!environment) return <div>Environment not found: {id}</div>;


  if (environment.type === 'grid') {
    return <GridEnvironmentView environment={environment as InstantiatedGridEnvironment} updateTrigger={updateTrigger} />;
  } else if (environment.type === 'graph') {
    return <GraphEnvironmentView environment={environment as InstantiatedGraphEnvironment} updateTrigger={updateTrigger} />;
  } else if (environment.type === 'uniform') {
    return <UniformEnvironmentView environment={environment as InstantiatedUniformEnvironment} />;
  } else {
    return <div>Unsupported environment type: {environment.type}</div>;
  }
};

const AnchoredParameterView = ({ id }: { id: string }) => {
  const parameters = useScenarioStore((store) => store.parameters);
  const parameter = parameters?.get(id);
  if (!parameter) return <div>Parameter not found: {id}</div>;

  return <ParameterControl parameter={parameter} />;
};

const AnchoredChartView = ({ id }: { id: string }) => {
  useScenarioStore((store) => store.currentTime); // subscribe to time step changes
  const charts = useScenarioStore((store) => store.charts);
  const chartGroup = charts?.getGroup(id);
  if (!chartGroup) return <div>Chart not found: {id}</div>;

  return <ChartView chartGroup={chartGroup} />;
}

export const AnchoredViewRenderer: AnchoredViewRendererType = ({ type, id }) => {

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
