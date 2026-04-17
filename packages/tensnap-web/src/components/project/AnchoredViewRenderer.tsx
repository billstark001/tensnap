import { GridEnvironmentView } from '../scenario/GridEnvironmentView';
import { GraphEnvironmentView } from '../scenario/GraphEnvironmentView';
import { UniformEnvironmentView } from '../scenario/UniformEnvironmentView';
import { ParameterControl } from './ParameterControl';
import { ChartView } from '../scenario/ChartView';
import { ScenarioStore, useScenarioStore } from '../../store/scenario/store';
import { getEnvironmentDisplayType, toGraphEnvironmentViewModel, toGridEnvironmentViewModel, toUniformEnvironmentViewModel } from '../scenario/environment-adapter';
import { useToast } from '@/store/toast';
import { AnchoredViewRendererType } from '../view/types';


const AnchoredEnvironmentView = ({ id }: { id: string }) => {

  const environments = useScenarioStore((store) => store.environments) ?? new Map() as ScenarioStore['environments'];
  const updateTrigger = useScenarioStore((store) => store.environmentUpdateTrigger.value);

  const environment = environments.get(id);
  if (!environment) return <div>Environment not found: {id}</div>;


  const displayType = getEnvironmentDisplayType(environment);

  if (displayType === 'grid') {
    return <GridEnvironmentView environment={toGridEnvironmentViewModel(environment)} updateTrigger={updateTrigger} />;
  } else if (displayType === 'graph') {
    return <GraphEnvironmentView environment={toGraphEnvironmentViewModel(environment)} updateTrigger={updateTrigger} />;
  } else if (displayType === 'uniform') {
    return <UniformEnvironmentView environment={toUniformEnvironmentViewModel(environment)} />;
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
  // Subscribe to _revision instead of currentTime: currentTime is a getter that gets
  // inlined as a stale value by Zustand's Object.assign after the first setState, so
  // it never changes. _revision is an explicit counter that increments every step.
  useScenarioStore((store) => store._revision);
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
