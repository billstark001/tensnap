import { useCallback } from 'react';
import { AnyView, ContainerView } from '@/types/ui';
import { useScenarioStore } from '@/store/scenario/store';
import { Parameter, Environment, ChartGroup, Action, BooleanParameter } from '@/types/model';
import { findAndDeleteView, findAndUpdateView, findAndAddView } from '../view/utils/container';
import {
  createButtonView,
  createParameterView,
  createChartView,
  createEnvironmentView,
} from '../view/utils/create-view';
import { generateUniqueId } from '@/utils/common';
import { ViewContextScheme } from '../view/useViewContext';

export function createAction(): Action {
  return {
    id: generateUniqueId(),
    label: 'New Button',
    allowRuntimeChange: false,
  };
}

/**
 * Creates a new boolean parameter
 */
export function createBooleanParameter(): BooleanParameter {
  return {
    id: generateUniqueId(),
    type: 'boolean',
    label: 'New Parameter',
    value: false,
    allowRuntimeChange: true,
  };
}

/**
 * Creates a new chart group
 */
export function createChartGroup(): ChartGroup {
  return {
    id: generateUniqueId(),
    label: 'New Chart',
    metadataDict: {},
    data: [],
  };
}

/**
 * Creates a new grid environment
 */
export function createGridEnvironment(): Environment {
  return {
    id: generateUniqueId(),
    type: 'grid',
    label: 'New Environment',
    agents: [],
    width: 10,
    height: 10,
  };
}

export function useCreateView(props: {
  onViewUpdate?: ViewContextScheme['onViewUpdate'];
}) {
  const { onViewUpdate } = props;
  const setData = useScenarioStore((store) => store.setData);
  const upsertAction = useScenarioStore((store) => store.upsertAction);

  /**
   * Creates a new view and its associated object
   */
  const createView = useCallback((
    type: AnyView['type'],
    position: { x: number; y: number },
    container: ContainerView
  ) => {
    let newView: AnyView;
    let newObject: Parameter | Environment | ChartGroup | Action | null = null;

    switch (type) {
      case 'button': {
        const action = createAction();
        newView = createButtonView(action, position);
        newObject = action;
        break;
      }
      case 'parameter': {
        const parameter = createBooleanParameter();
        newView = createParameterView(parameter, position);
        newObject = parameter;
        break;
      }
      case 'chart': {
        const chartGroup = createChartGroup();
        newView = createChartView(chartGroup, position);
        newObject = chartGroup;
        break;
      }
      case 'environment': {
        const environment = createGridEnvironment();
        newView = createEnvironmentView(environment, position);
        newObject = environment;
        break;
      }
      default:
        return;
    }

    // Add the view
    findAndAddView(container, container.id, newView);
    onViewUpdate?.(container.id, container);

    // Add the associated object
    if (newObject) {
      if (type === 'button') {
        upsertAction?.(newObject as Action);
      } else if (type === 'parameter') {
        setData?.({ parameters: [newObject as Parameter] }, { updateLayout: false, preserveExisting: true });
      } else if (type === 'environment') {
        setData?.({ environments: [newObject as Environment] }, { updateLayout: false, preserveExisting: true });
      } else if (type === 'chart') {
        // For charts, we need to create a ChartGroupMetadata
        const chartGroup = newObject as ChartGroup;
        setData?.({
          charts: [{
            id: chartGroup.id,
            label: chartGroup.label,
            dataList: Object.values(chartGroup.metadataDict)
          }]
        }, { updateLayout: false, preserveExisting: true });
      }
    }
  }, [onViewUpdate, setData, upsertAction]);

  return { createView };
}

export interface UseUpdateAndDeleteViewOptions {
  parentView?: ContainerView;
  onViewUpdate?: (id: string, view: ContainerView) => void;
}

export function useUpdateAndDeleteView(options: UseUpdateAndDeleteViewOptions) {
  const { parentView, onViewUpdate } = options;

  // Store actions
  const setData = useScenarioStore((store) => store.setData);

  const updateParameterProps = useScenarioStore((store) => store.updateParameterProps);
  const updateEnvironment = useScenarioStore((store) => store.updateEnvironment);
  const updateChartProps = useScenarioStore((store) => store.updateChartProps);

  const renameParameter = useScenarioStore((store) => store.renameParameter);
  const renameEnvironment = useScenarioStore((store) => store.renameEnvironment);
  const renameChartGroup = useScenarioStore((store) => store.renameChartGroup);
  // const renameChartMetadata = useScenarioStore((store) => store.renameChartMetadata);


  /**
   * Deletes a view and its associated object
   */
  const deleteView = useCallback((viewId: string) => {
    if (!parentView) return;

    // Find the view to get its data
    const findView = (container: ContainerView, id: string): AnyView | null => {
      for (const view of container.views) {
        if (view.id === id) return view;
        if (view.type === 'container') {
          const found = findView(view as ContainerView, id);
          if (found) return found;
        }
      }
      return null;
    };

    const view = findView(parentView, viewId);

    // Delete the view
    findAndDeleteView(parentView, viewId);
    onViewUpdate?.(parentView.id, parentView);

    // Delete the associated object
    if (view && view.type !== 'container') {
      const objectId = view.data.id;
      if (view.type === 'button' || view.type === 'parameter') {
        setData?.({ removedParameterIds: [objectId] }, { updateLayout: false, preserveExisting: true });
      } else if (view.type === 'environment') {
        setData?.({ removedEnvironmentIds: [objectId] }, { updateLayout: false, preserveExisting: true });
      } else if (view.type === 'chart') {
        setData?.({ removedChartIds: [objectId] }, { updateLayout: false, preserveExisting: true });
      }
    }
  }, [parentView, onViewUpdate, setData]);

  /**
   * Updates a view and its associated object
   */
  const updateView = useCallback((updatedView: AnyView, objectData?: any) => {
    const updateRoot = parentView ?? (updatedView.type === 'container' ? updatedView as ContainerView : null);
    if (!updateRoot) {
      return;
    }

    // Update the view
    const { id: viewId, type: _, data, ...rest } = updatedView;
    delete (rest as any).views;

    const origId = (data as any)?.id;
    let newId: string | undefined = undefined;

    // Update the associated object data if provided
    if (objectData) {
      if (updatedView.type === 'parameter' || updatedView.type === 'button') {
        const { id, ...props } = objectData;
        if (origId && origId !== id) {
          renameParameter?.(origId, id);
          newId = id;
        }
        updateParameterProps?.(id, props);
      } else if (updatedView.type === 'environment') {
        const { id, ...envData } = objectData;
        if (origId && origId !== id) {
          renameEnvironment?.(origId, id);
          newId = id;
        }
        updateEnvironment?.(id, envData);
      } else if (updatedView.type === 'chart') {
        const { id, ...props } = objectData;
        if (origId && origId !== id) {
          renameChartGroup?.(origId, id);
          newId = id;
        }
        updateChartProps?.(id, props);
      }
    }

    findAndUpdateView(updateRoot, viewId, newId != null ? { ...rest, data: { ...data, id: newId } } : rest);
    onViewUpdate?.(updateRoot.id, updateRoot);
  }, [parentView, onViewUpdate, updateParameterProps, updateEnvironment, updateChartProps]);

  return {
    deleteView,
    updateView,
  };
}
