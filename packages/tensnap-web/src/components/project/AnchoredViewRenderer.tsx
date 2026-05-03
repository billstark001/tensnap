import { Environment2DView } from '../scenario/Environment2DView';
import { UniformEnvironmentView } from '../scenario/UniformEnvironmentView';
import { ParameterControl } from './ParameterControl';
import { ChartView } from '../scenario/ChartView';
import { ScenarioStore, useScenarioStore } from '../../store/scenario/store';
import { getEnvironmentDisplayType } from '../scenario/environment-adapter';
import { useToast } from '@/store/toast';
import { AnchoredViewRendererType } from '../view/types';
import { AnchoredView } from '@/types/ui';
import { ViewErrorBoundary } from '../view/ViewErrorBoundary';


const AnchoredEnvironmentView = ({ id, view }: { id: string; view: AnchoredView }) => {

  const environments = useScenarioStore((store) => store.environments) ?? new Map() as ScenarioStore['environments'];
  const updateTrigger = useScenarioStore((store) => store.environmentUpdateTrigger.value);

  const environment = environments.get(id);
  if (!environment) return <div>Environment not found: {id}</div>;


  const displayType = getEnvironmentDisplayType(environment);

  if (displayType === '2d') {
    return (
      <ViewErrorBoundary kind="environment" identifier={id} resetKey={updateTrigger}>
        <Environment2DView environment={environment} updateTrigger={updateTrigger} view={view} />
      </ViewErrorBoundary>
    );
  } else if (displayType === 'uniform') {
    return (
      <ViewErrorBoundary kind="environment" identifier={id} resetKey={updateTrigger}>
        <UniformEnvironmentView environment={environment} updateTrigger={updateTrigger} view={view} />
      </ViewErrorBoundary>
    );
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
  const revision = useScenarioStore((store) => store._revision);
  const charts = useScenarioStore((store) => store.charts);
  const chartGroup = charts?.getGroup(id);
  if (!chartGroup) return <div>Chart not found: {id}</div>;

  return (
    <ViewErrorBoundary kind="chart" identifier={id} resetKey={revision}>
      <ChartView chartGroup={chartGroup} />
    </ViewErrorBoundary>
  );
}

export const AnchoredViewRenderer: AnchoredViewRendererType = ({ type, id, view }) => {

  const toast = useToast();
  switch (type) {
    case 'environment': {
      return <AnchoredEnvironmentView id={id} view={view as AnchoredView} />;
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
