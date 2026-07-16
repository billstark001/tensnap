import { useCallback } from 'react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { AnyView, ContainerView } from '@/types/ui';
import { useScenarioStore } from '@/store/scenario/store';
import { Parameter, ChartGroup, Action, BooleanParameter } from '@/types/model';
import type { MonitorState } from '@tensnap/core/monitor';
import { EditableEnvironmentDraft } from '@/store/scenario/store';
import { findView } from '@/utils/view/container';
import { addViewToContainerInPlace, deleteViewInPlace, updateViewInPlace } from '@/utils/view/mutation';
import {
  createButtonView,
  createParameterView,
  createChartView,
  createEnvironmentView,
  createMonitorView,
} from '@/utils/view/create-view';
import { generateUniqueId } from '@/utils/common';
import { ViewUpdateHandler } from '../view/useViewContext';
import { useToast } from '@/store/toast';
import { MessageDescriptor } from '@lingui/core';
import { useRecordViewHistory } from '@/store/view-history';
import { getEditableEnvironmentData, type EditableEnvironmentData } from '@/dialogs/edit-views/environment-editor-model';

// #region Types

type Position = { x: number; y: number };
type CreatableViewType = Extract<AnyView['type'], 'button' | 'parameter' | 'chart' | 'environment' | 'monitor'>;
type ViewObject = Parameter | EditableEnvironmentDraft | ChartGroup | Action;

type CreateViewResult<TObject extends ViewObject = ViewObject> = {
  view: AnyView;
  object: TObject;
};

type RenameObjectOptions = {
  currentId?: string;
  nextId: string;
  exists: (id: string) => boolean;
  rename?: (fromId: string, toId: string) => boolean;
  duplicateMessage: MessageDescriptor;
  renameFailedMessage: MessageDescriptor;
};

// #endregion

// #region Default object factories

export function createAction(): Action {
  return {
    id: generateUniqueId(),
    label: 'New Button',
  };
}

/** Creates a boolean parameter with default editor-friendly values. */
export function createBooleanParameter(): BooleanParameter {
  return {
    id: generateUniqueId(),
    type: 'boolean',
    label: 'New Parameter',
    value: false,
    allow_runtime_change: true,
  };
}

/** Creates an empty chart group that can be populated later. */
export function createChartGroup(): ChartGroup {
  return {
    id: generateUniqueId(),
    label: 'New Chart',
    metadataDict: {},
    data: [],
  };
}

/** Creates a default 2D environment. */
export function create2DEnvironment(): EditableEnvironmentDraft {
  return {
    id: generateUniqueId(),
    type: '2d',
    label: 'New Environment',
    width: 10,
    height: 10,
  };
}

// #endregion

// #region View creation helpers

function buildView(type: CreatableViewType, position: Position, monitors: readonly MonitorState[]): CreateViewResult | null {
  switch (type) {
    case 'button': {
      const action = createAction();
      return { object: action, view: createButtonView(action, position) };
    }
    case 'parameter': {
      const parameter = createBooleanParameter();
      return { object: parameter, view: createParameterView(parameter, position) };
    }
    case 'chart': {
      const chartGroup = createChartGroup();
      return { object: chartGroup, view: createChartView(chartGroup, position) };
    }
    case 'environment': {
      const environment = create2DEnvironment();
      return { object: environment, view: createEnvironmentView(environment, position) };
    }
    case 'monitor': {
      const monitor = monitors[0];
      return monitor ? { object: monitor as never, view: createMonitorView(monitor, position) } : null;
    }
    default:
      return null;
  }
}

function toChartPayload(chartGroup: ChartGroup) {
  return {
    id: chartGroup.id,
    label: chartGroup.label,
    data_list: Object.values(chartGroup.metadataDict),
  };
}

// #endregion

// #region Create view hook

export function useCreateView(props: { onViewUpdate?: ViewUpdateHandler }) {
  const { onViewUpdate } = props;
  const rootView = useScenarioStore((store) => store.mainView);
  const setData = useScenarioStore((store) => store.setData);
  const upsertAction = useScenarioStore((store) => store.upsertAction);
  const scenario = useScenarioStore((store) => store.scenario);
  const recordViewHistory = useRecordViewHistory();

  /** Creates a view and persists its backing object in the scenario store. */
  const createView = useCallback((
    type: AnyView['type'],
    position: Position,
    container: ContainerView,
  ) => {
    if (!rootView) return;

    const result = buildView(type as CreatableViewType, position, scenario ? [...scenario.monitors.all.values()] : []);
    if (!result) return;

    const before = structuredClone(rootView);
    addViewToContainerInPlace({ rootView, onViewUpdate }, container.id, result.view);

    switch (type) {
      case 'button':
        upsertAction?.(result.object as Action);
        break;
      case 'parameter':
        setData?.({ parameters: [result.object as Parameter] }, { updateLayout: false, preserveExisting: true });
        break;
      case 'environment':
        setData?.({ environments: [result.object as EditableEnvironmentDraft] }, { updateLayout: false, preserveExisting: true });
        break;
      case 'chart':
        setData?.({ charts: [toChartPayload(result.object as ChartGroup)] }, { updateLayout: false, preserveExisting: true });
        break;
      case 'monitor':
        // Monitors belong to the simulator. A local view only binds to one.
        break;
      default:
        break;
    }
    recordViewHistory(`Create ${type} view`, 'layout', before, rootView);
  }, [rootView, onViewUpdate, setData, upsertAction, scenario, recordViewHistory]);

  return { createView };
}

// #endregion

// #region Update and delete hook types

export interface UseUpdateAndDeleteViewOptions {
  parentView?: ContainerView;
  onViewUpdate?: ViewUpdateHandler;
}

export interface UpdateViewResult {
  ok: boolean;
  message?: string;
}

// #endregion

// #region Update and delete hook

export function useUpdateAndDeleteView(options: UseUpdateAndDeleteViewOptions) {
  const { parentView, onViewUpdate } = options;
  const { _ } = useLingui();
  const toast = useToast();

  const rootView = useScenarioStore((store) => store.mainView);
  const actions = useScenarioStore((store) => store.actions);
  const parameters = useScenarioStore((store) => store.parameters);
  const environments = useScenarioStore((store) => store.environments);
  const charts = useScenarioStore((store) => store.charts);

  const updateActionProps = useScenarioStore((store) => store.updateActionProps);
  const updateParameterProps = useScenarioStore((store) => store.updateParameterProps);
  const updateEnvironment = useScenarioStore((store) => store.updateEnvironment);
  const updateChartProps = useScenarioStore((store) => store.updateChartProps);

  const renameAction = useScenarioStore((store) => store.renameAction);
  const renameParameter = useScenarioStore((store) => store.renameParameter);
  const renameEnvironment = useScenarioStore((store) => store.renameEnvironment);
  const renameChartGroup = useScenarioStore((store) => store.renameChartGroup);
  const recordViewHistory = useRecordViewHistory();

  const restoreLinkedObject = useCallback((
    type: AnyView['type'],
    fromId: string,
    target: Action | Parameter | ChartGroup | EditableEnvironmentData,
  ) => {
    const targetId = target.id;
    const rename = () => {
      if (fromId === targetId) return true;
      switch (type) {
        case 'button': return renameAction?.(fromId, targetId) ?? false;
        case 'parameter': return renameParameter?.(fromId, targetId) ?? false;
        case 'environment': return renameEnvironment?.(fromId, targetId) ?? false;
        case 'chart': return renameChartGroup?.(fromId, targetId) ?? false;
        default: return true;
      }
    };
    if (!rename()) throw new Error(`The ${type} object is no longer available for history replay.`);
    const props = { ...target } as any;
    delete props.id;
    let updated = true;
    switch (type) {
      case 'button': updated = updateActionProps?.(targetId, props) ?? false; break;
      case 'parameter': updated = updateParameterProps?.(targetId, props) ?? false; break;
      case 'environment': updated = updateEnvironment?.(targetId, props) ?? false; break;
      case 'chart': updated = updateChartProps?.(targetId, props) ?? false; break;
      default: break;
    }
    if (!updated) throw new Error(`The ${type} object could not be restored.`);
  }, [
    renameAction,
    renameParameter,
    renameEnvironment,
    renameChartGroup,
    updateActionProps,
    updateParameterProps,
    updateEnvironment,
    updateChartProps,
  ]);

  const fail = useCallback((messageDescriptor: MessageDescriptor): UpdateViewResult => {
    const message = _(messageDescriptor);
    toast.error(_(msg`Failed to update view`), message);
    return { ok: false, message };
  }, [_, toast]);

  const warn = useCallback((messageDescriptor: MessageDescriptor) => {
    const message = _(messageDescriptor);
    toast.warning(_(msg`Failed to update view`), message);
  }, [_, toast]);

  const renameLinkedObject = useCallback((options: RenameObjectOptions): UpdateViewResult & { newId?: string } => {
    const { currentId, nextId, exists, rename, duplicateMessage, renameFailedMessage } = options;

    // Only rename an existing backing object when the user actually changed the id.
    if (!currentId || currentId === nextId || !exists(currentId)) {
      return { ok: true };
    }

    if (exists(nextId)) {
      warn(duplicateMessage);
    }

    if (!rename?.(currentId, nextId)) {
      return fail(renameFailedMessage);
    }

    return { ok: true, newId: nextId };
  }, [fail, warn]);

  /** Deletes a view and removes its backing object from the scenario store. */
  const deleteView = useCallback((viewId: string) => {
    if (!rootView || !parentView) return;

    const before = structuredClone(rootView);
    const view = deleteViewInPlace({ rootView, onViewUpdate }, viewId);
    if (!view) return;
    // Deleting a renderer view must not delete the live simulator object it
    // references; this also makes undo safe while the session keeps running.
    recordViewHistory(`Delete ${view.type} view`, 'layout', before, rootView);
  }, [rootView, parentView, onViewUpdate, recordViewHistory]);

  /** Updates view props and, when provided, keeps backing object data in sync. */
  const updateView = useCallback((updatedView: AnyView, objectData?: any): UpdateViewResult => {
    const updateRoot = rootView ?? parentView ?? (updatedView.type === 'container' ? updatedView as ContainerView : null);
    if (!updateRoot) {
      return fail(msg`No view tree is available.`);
    }

    const targetView = findView(updateRoot, updatedView.id);
    if (!targetView) {
      return fail(msg`The view no longer exists.`);
    }
    const before = structuredClone(updateRoot);

    const { data, ...viewProps } = updatedView;
    delete (viewProps as Partial<AnyView>).type;
    delete (viewProps as any).views;

    const currentObjectId = (targetView as any).data?.id as string | undefined;
    const beforeObject = currentObjectId ? (() => {
      switch (updatedView.type) {
        case 'button': return actions?.get(currentObjectId) ? structuredClone(actions.get(currentObjectId)!) : null;
        case 'parameter': return parameters?.get(currentObjectId) ? structuredClone(parameters.get(currentObjectId)!) : null;
        case 'environment': return getEditableEnvironmentData(environments, currentObjectId);
        case 'chart': {
          const chart = charts?.getGroup(currentObjectId);
          return chart ? { id: chart.id, label: chart.label, metadataDict: structuredClone(chart.metadataDict), data: [] } : null;
        }
        default: return null;
      }
    })() : null;
    let nextObjectId: string | undefined;

    if (objectData) {
      const { id, ...props } = objectData;
      let renameResult: UpdateViewResult & { newId?: string } = { ok: true };

      switch (updatedView.type) {
        case 'button':
          renameResult = renameLinkedObject({
            currentId: currentObjectId,
            nextId: id,
            exists: (objectId) => Boolean(actions?.has(objectId)),
            rename: renameAction,
            duplicateMessage: msg`An action with this ID already exists.`,
            renameFailedMessage: msg`The action ID could not be changed.`,
          });
          if (!renameResult.ok) return renameResult;
          updateActionProps?.(id, props);
          break;

        case 'parameter':
          renameResult = renameLinkedObject({
            currentId: currentObjectId,
            nextId: id,
            exists: (objectId) => Boolean(parameters?.has(objectId)),
            rename: renameParameter,
            duplicateMessage: msg`A parameter with this ID already exists.`,
            renameFailedMessage: msg`The parameter ID could not be changed.`,
          });
          if (!renameResult.ok) return renameResult;
          updateParameterProps?.(id, props);
          break;

        case 'environment':
          renameResult = renameLinkedObject({
            currentId: currentObjectId,
            nextId: id,
            exists: (objectId) => Boolean(environments?.has(objectId)),
            rename: renameEnvironment,
            duplicateMessage: msg`An environment with this ID already exists.`,
            renameFailedMessage: msg`The environment ID could not be changed.`,
          });
          if (!renameResult.ok) return renameResult;
          updateEnvironment?.(id, props);
          break;

        case 'chart':
          renameResult = renameLinkedObject({
            currentId: currentObjectId,
            nextId: id,
            exists: (objectId) => Boolean(charts?.getGroup(objectId)),
            rename: renameChartGroup,
            duplicateMessage: msg`A chart group with this ID already exists.`,
            renameFailedMessage: msg`The chart group ID could not be changed.`,
          });
          if (!renameResult.ok) return renameResult;
          updateChartProps?.(id, props);
          break;

        default:
          break;
      }

      nextObjectId = renameResult.newId;
    }

    updateViewInPlace(
      {
        rootView: updateRoot,
        onViewUpdate,
        notifyView: updateRoot,
      },
      targetView,
      {
        ...viewProps,
        data: nextObjectId ? { ...data, id: nextObjectId } : data,
      } as Partial<AnyView>,
    );

    const afterObject = objectData
      ? updatedView.type === 'chart'
        ? { id: objectData.id, label: objectData.label, metadataDict: structuredClone(objectData.metadataDict), data: [] }
        : structuredClone(objectData)
      : null;
    const sideEffects = beforeObject && afterObject ? {
      byteSize: new TextEncoder().encode(JSON.stringify([beforeObject, afterObject])).byteLength,
      apply: () => restoreLinkedObject(updatedView.type, beforeObject.id, afterObject),
      revert: () => restoreLinkedObject(updatedView.type, afterObject.id, beforeObject),
    } : undefined;
    recordViewHistory(
      `Edit ${updatedView.type} view`,
      'view-config',
      before,
      updateRoot,
      sideEffects ? undefined : `view-config:${updatedView.id}`,
      sideEffects,
    );

    return { ok: true };
  }, [
    rootView,
    parentView,
    fail,
    actions,
    parameters,
    environments,
    charts,
    renameLinkedObject,
    renameAction,
    renameParameter,
    renameEnvironment,
    renameChartGroup,
    updateActionProps,
    updateParameterProps,
    updateEnvironment,
    updateChartProps,
    onViewUpdate,
    recordViewHistory,
    restoreLinkedObject,
  ]);

  return {
    deleteView,
    updateView,
  };
}

// #endregion
