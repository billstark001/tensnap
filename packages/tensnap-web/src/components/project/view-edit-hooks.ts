import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { useCallback } from 'react';
import type { AnyView, ContainerView } from '@tensnap/core/persistence';
import type { Parameter } from '@/types/model';
import { useScenarioStore } from '@/store/scenario/store';
import { findView } from '@/utils/view/container';
import {
  addViewToContainerInPlace,
  deleteViewInPlace,
  updateViewInPlace,
} from '@/utils/view/mutation';
import {
  createButtonView,
  createParameterView,
  createChartView,
  createEnvironmentView,
  createMonitorView,
} from '@/utils/view/create-view';
import type { ViewUpdateHandler } from '../view/useViewContext';
import { useToast } from '@/store/toast';
import { useRecordViewHistory } from '@/store/view-history';
import { applyViewEdit } from '@/dialogs/edit-views/edit-view-model';

export function useCreateView({ onViewUpdate }: { onViewUpdate?: ViewUpdateHandler }) {
  const rootView = useScenarioStore((state) => state.mainView);
  const scenario = useScenarioStore((state) => state.scenario);
  const record = useRecordViewHistory();
  const toast = useToast();
  const { _ } = useLingui();
  const createView = useCallback(
    (type: AnyView['type'], position: { x: number; y: number }, container: ContainerView) => {
      if (!scenario || !rootView) return;
      const action = scenario.actions.values().next().value;
      const parameter = scenario.parameters.values().next().value;
      const environment = scenario.environments.values().next().value;
      const chart = scenario.charts.getGroupList()[0];
      const monitor = scenario.monitors.all.values().next().value;
      const view =
        type === 'button' && action
          ? createButtonView(action, position)
          : type === 'parameter' && parameter
            ? createParameterView(parameter, position)
            : type === 'environment' && environment
              ? createEnvironmentView(
                  { id: environment.id, type: environment.type, label: environment.id },
                  position,
                )
              : type === 'chart' && chart
                ? createChartView(chart, position)
                : type === 'monitor' && monitor
                  ? createMonitorView(monitor, position)
                  : null;
      if (!view) {
        toast.warning(_(msg`No registered object is available for this view.`));
        return;
      }
      const before = structuredClone(rootView);
      addViewToContainerInPlace({ rootView, onViewUpdate }, container.id, view);
      record(`Create ${type} view`, 'layout', before, rootView);
    },
    [rootView, scenario, onViewUpdate, record, toast, _],
  );
  return { createView };
}

export interface UseUpdateAndDeleteViewOptions {
  parentView?: ContainerView;
  onViewUpdate?: ViewUpdateHandler;
}
export interface UpdateViewResult {
  ok: boolean;
  message?: string;
}

export function useUpdateAndDeleteView({
  parentView,
  onViewUpdate,
}: UseUpdateAndDeleteViewOptions) {
  const rootView = useScenarioStore((state) => state.mainView);
  const session = useScenarioStore((state) => state.session);
  const record = useRecordViewHistory();
  const toast = useToast();
  const { _ } = useLingui();
  const deleteView = useCallback(
    (viewId: string) => {
      if (!parentView || !rootView) return;
      const before = structuredClone(rootView);
      const removed = deleteViewInPlace({ rootView, onViewUpdate }, viewId);
      if (removed) record(`Delete ${removed.type} view`, 'layout', before, rootView);
    },
    [rootView, parentView, onViewUpdate, record],
  );
  const updateView = useCallback(
    (
      edited: AnyView,
      parameterChange: { id: string; value: Parameter['value'] } | undefined,
      baseline: AnyView,
    ): UpdateViewResult => {
      try {
        if (!rootView) throw new Error('No view tree is available.');
        const current = findView(rootView, edited.id);
        if (!current) throw new Error('The view no longer exists.');
        const merged = applyViewEdit(current, baseline, edited);
        if (parameterChange) {
          if (!session) throw new Error('No simulator is connected.');
          if (merged.type !== 'parameter' || merged.data.id !== parameterChange.id)
            throw new Error('Parameter binding changed.');
          const parameter = session.scenario.getParameter(parameterChange.id);
          if (!parameter) throw new Error('Parameter is no longer available.');
          if (session.run.status?.state === 'running' && !parameter.allow_runtime_change)
            throw new Error('This parameter cannot change during a run.');
          const value = parameterChange.value;
          if (
            parameter.type === 'number' &&
            (typeof value !== 'number' ||
              !Number.isFinite(value) ||
              (parameter.min !== undefined && value < parameter.min) ||
              (parameter.max !== undefined && value > parameter.max))
          )
            throw new Error('Parameter value is outside the allowed range.');
          if (parameter.type === 'boolean' && typeof value !== 'boolean')
            throw new Error('Expected a boolean parameter value.');
          if (parameter.type === 'enum' && !parameter.options.includes(String(value)))
            throw new Error('Unknown parameter option.');
          session.setParameter(parameter.id, value);
        }
        const before = structuredClone(rootView);
        updateViewInPlace({ rootView, onViewUpdate, notifyView: rootView }, current, merged);
        record(`Edit ${edited.type} view`, 'view-config', before, rootView);
        return { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        toast.error(_(msg`Failed to update view`), message);
        return { ok: false, message };
      }
    },
    [rootView, session, onViewUpdate, record, toast, _],
  );
  return { deleteView, updateView };
}
