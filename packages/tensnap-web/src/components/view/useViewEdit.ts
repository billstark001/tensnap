import { useCallback } from 'react';
import { AnyView, ContainerView, ButtonView, AnchoredView } from '@/types/ui';
import { useScenarioStore } from '@/store/scenario/store';
import { generateUniqueId } from '@/utils/common';
import { Parameter, Environment, ChartGroup } from '@/types/model';
import { findAndDeleteView, findAndUpdateView, findAndAddView } from './utils/container';

export interface UseViewEditOptions {
  parentView?: ContainerView;
  onViewUpdate?: (id: string, view: ContainerView) => void;
}

/**
 * Hook that consolidates all view editing operations including:
 * - Creating new views (and associated objects)
 * - Deleting views (and associated objects)
 * - Updating views (and associated objects)
 */
export function useViewEdit(options: UseViewEditOptions) {
  const { parentView, onViewUpdate } = options;

  // Store actions
  const setData = useScenarioStore((store) => store.setData);
  const updateParameterProps = useScenarioStore((store) => store.updateParameterProps);
  const updateEnvironment = useScenarioStore((store) => store.updateEnvironment);
  const updateChartProps = useScenarioStore((store) => store.updateChartProps);

  /**
   * Creates a new view and its associated object
   */
  const handleCreateView = useCallback((
    type: AnyView['type'],
    position: { x: number; y: number },
    container: ContainerView
  ) => {
    const baseProps = {
      id: generateUniqueId(),
      type,
      left: position.x,
      top: position.y,
      expanded: true,
    };

    let newView: AnyView;
    let newObject: Parameter | Environment | ChartGroup | null = null;

    switch (type) {
      case 'button': {
        const parameterId = generateUniqueId();
        newView = {
          ...baseProps,
          width: 120,
          height: 40,
          data: { id: parameterId, text: 'New Button' },
        } as ButtonView;
        newObject = {
          id: parameterId,
          type: 'action',
          label: 'New Button',
          allowRuntimeChange: false,
        } as Parameter;
        break;
      }
      case 'parameter': {
        const parameterId = generateUniqueId();
        newView = {
          ...baseProps,
          width: 200,
          height: 80,
          data: { id: parameterId, title: 'New Parameter', type: 'boolean' },
        } as AnchoredView;
        newObject = {
          id: parameterId,
          type: 'boolean',
          label: 'New Parameter',
          value: false,
          allowRuntimeChange: true,
        } as Parameter;
        break;
      }
      case 'chart': {
        const chartId = generateUniqueId();
        newView = {
          ...baseProps,
          width: 400,
          height: 300,
          data: { id: chartId, title: 'New Chart' },
        } as AnchoredView;
        newObject = {
          id: chartId,
          label: 'New Chart',
          metadataDict: {},
          data: [],
        } as ChartGroup;
        break;
      }
      case 'environment': {
        const envId = generateUniqueId();
        newView = {
          ...baseProps,
          width: 400,
          height: 400,
          data: { id: envId, title: 'New Environment', type: 'grid' },
        } as AnchoredView;
        newObject = {
          id: envId,
          type: 'grid',
          label: 'New Environment',
          agents: [],
          width: 10,
          height: 10,
        } as Environment;
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
      if (type === 'button' || type === 'parameter') {
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
  }, [onViewUpdate, setData]);

  /**
   * Deletes a view and its associated object
   */
  const handleDeleteView = useCallback((viewId: string) => {
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
  const handleUpdateView = useCallback((updatedView: AnyView, objectData?: any) => {
    const updateRoot = parentView ?? (updatedView.type === 'container' ? updatedView as ContainerView : null);
    if (!updateRoot) {
      return;
    }

    // Update the view
    const { id: viewId, type: _, ...rest } = updatedView;
    delete (rest as any).views;
    findAndUpdateView(updateRoot, viewId, rest);
    onViewUpdate?.(updateRoot.id, updateRoot);

    // Update the associated object data if provided
    if (objectData) {
      if (updatedView.type === 'parameter' || updatedView.type === 'button') {
        const { id, ...props } = objectData;
        updateParameterProps?.(id, props);
      } else if (updatedView.type === 'environment') {
        const { id, ...envData } = objectData;
        updateEnvironment?.(id, envData);
      } else if (updatedView.type === 'chart') {
        const { id, ...props } = objectData;
        updateChartProps?.(id, props);
      }
    }
  }, [parentView, onViewUpdate, updateParameterProps, updateEnvironment, updateChartProps]);

  return {
    handleCreateView,
    handleDeleteView,
    handleUpdateView,
  };
}
