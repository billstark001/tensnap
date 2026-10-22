import { defineDialog } from '@tensnap/web-common/workbench/dialog-content';
import { useState } from 'react';
import * as Dialog from '@tensnap/web-common/components/ui/Dialog';
import type { AnyView, ButtonView, AnchoredView } from '@tensnap/core/persistence';
import { Trans } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { presentEnvironment } from '@tensnap/core/scenario';
import type { DialogOpenProps } from '@tensnap/web-common/react';
import { ButtonViewEditor } from './ButtonViewEditor';
import { ContainerViewEditor } from './ContainerViewEditor';
import { EnvironmentViewEditor } from './EnvironmentViewEditor';
import { ParameterViewEditor } from './ParameterViewEditor';
import { ChartViewEditor } from './ChartViewEditor';
import { MonitorViewEditor } from './MonitorViewEditor';
import { BaseViewFields } from './BaseViewEditor';
import { ObjectBindingField } from './ObjectBindingField';
import { useScenarioStore } from '@/store/scenario/store';
import { useToast } from '@/store/toast';
import type { Parameter } from '@/types/model';
import * as styles from './EditViews.css';

interface EditViewDialogProps extends DialogOpenProps {
  view: AnyView;
  onSave: (
    view: AnyView,
    parameterChange?: { id: string; value: Parameter['value'] },
  ) =>
    | void
    | boolean
    | { ok: boolean; message?: string }
    | Promise<void | boolean | { ok: boolean; message?: string }>;
}

function EditViewDialogEditor({ open, onOpenChange, view, onSave }: EditViewDialogProps) {
  const [draft, setDraft] = useState(() => structuredClone(view));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetVersion, setResetVersion] = useState(0);
  const [parameterChange, setParameterChange] = useState<{
    id: string;
    value: Parameter['value'];
  }>();
  const scenario = useScenarioStore((state) => state.scenario);
  const toast = useToast();
  const { _ } = useLingui();
  useScenarioStore((state) =>
    draft.type === 'environment'
      ? state.environmentUpdateTrigger.value
      : draft.type === 'chart'
        ? state.chartRevision
        : draft.type === 'monitor'
          ? state.monitorRevision
          : draft.type === 'button'
            ? state.actionRevision
            : draft.type === 'parameter'
              ? state.parameterUpdateTrigger.value
              : 0,
  );
  const reset = () => {
    setDraft(structuredClone(view));
    setDirty(false);
    setParameterChange(undefined);
    setResetVersion((version) => version + 1);
  };
  const change = (field: string, value: unknown) => {
    setDraft((previous) => {
      const next = { ...previous, data: { ...previous.data } } as AnyView;
      const target = field.startsWith('data.') ? next.data! : next;
      const key = field.startsWith('data.') ? field.slice(5) : field;
      if (value === undefined) delete (target as Record<string, unknown>)[key];
      else (target as Record<string, unknown>)[key] = value;
      return next;
    });
    setDirty(true);
  };
  const id = draft.type === 'container' ? '' : draft.data.id;
  const bind = (nextId: string) => {
    setDraft((previous) => {
      const next = structuredClone(previous);
      if (next.type === 'container') return next;
      const source = (objectId: string) =>
        next.type === 'environment'
          ? scenario?.getEnvironment(objectId)
          : next.type === 'chart'
            ? scenario?.charts.getGroup(objectId)
            : next.type === 'monitor'
              ? scenario?.monitors.get(objectId)
              : next.type === 'parameter'
                ? scenario?.getParameter(objectId)
                : scenario?.getAction(objectId);
      const old = source(next.data.id),
        replacement = source(nextId);
      const label = (object: ReturnType<typeof source>) =>
        object && 'label' in object ? object.label : object?.id;
      if (next.type === 'button') {
        if (!next.data.text || next.data.text === label(old))
          next.data.text = label(replacement) ?? nextId;
      } else if (!next.data.title || next.data.title === label(old))
        next.data.title = label(replacement) ?? nextId;
      next.data.id = nextId;
      if (next.type === 'environment') {
        delete next.data.layerOverrides;
        delete next.data.type;
      }
      if (next.type === 'chart') delete next.data.chartSeries;
      return next;
    });
    setParameterChange(undefined);
    setDirty(true);
  };
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const series = draft.type === 'chart' ? draft.data.chartSeries : undefined;
      if (
        series &&
        (series.some((item) => !item.id.trim()) ||
          new Set(series.map((item) => item.id)).size !== series.length)
      )
        throw new Error('Series IDs must be non-empty and unique.');
      if (draft.type === 'environment') {
        const environment = scenario?.getEnvironment(draft.data.id);
        if (environment) presentEnvironment(environment, draft.data.layerOverrides);
      }
      const result = await onSave(draft, parameterChange);
      if (result === false || (result && typeof result === 'object' && !result.ok)) return;
      onOpenChange?.(false);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog.Root title={_(msg`Edit View`)} open={open} onOpenChange={onOpenChange} size="xl">
      <Dialog.Body>
        <div className={styles.editor}>
          {draft.type !== 'container' && (
            <>
              <BaseViewFields view={draft} onChange={change} />
              <ObjectBindingField view={draft} onChange={bind} />
            </>
          )}
          <div key={`${draft.type}:${id}:${resetVersion}`}>
            {draft.type === 'button' && (
              <ButtonViewEditor
                view={draft as ButtonView}
                action={scenario?.getAction(id) ?? null}
                onChange={change}
              />
            )}
            {draft.type === 'environment' && (
              <EnvironmentViewEditor
                view={draft as AnchoredView}
                environment={scenario?.getEnvironment(id)}
                onChange={change}
              />
            )}
            {draft.type === 'parameter' && (
              <ParameterViewEditor
                view={draft as AnchoredView}
                parameter={scenario?.getParameter(id) ?? null}
                onChange={change}
                onValueChange={(value) => {
                  setParameterChange({ id, value });
                  setDirty(true);
                }}
              />
            )}
            {draft.type === 'chart' && (
              <ChartViewEditor
                view={draft as AnchoredView}
                chart={scenario?.charts.getGroup(id)}
                onChange={change}
              />
            )}
            {draft.type === 'monitor' && (
              <MonitorViewEditor view={draft as AnchoredView} onChange={change} />
            )}
            {draft.type === 'container' && <ContainerViewEditor view={draft} onChange={change} />}
          </div>
        </div>
      </Dialog.Body>
      <Dialog.Footer>
        <Dialog.Button onClick={reset} disabled={!dirty || saving}>
          <Trans>Reset</Trans>
        </Dialog.Button>
        <Dialog.Button variant="primary" onClick={save} disabled={!dirty || saving}>
          <Trans>Save</Trans>
        </Dialog.Button>
      </Dialog.Footer>
    </Dialog.Root>
  );
}

function EditViewDialogContent(props: EditViewDialogProps) {
  return props.open ? <EditViewDialogEditor key={props.view.id} {...props} /> : null;
}

export const EditViewDialog = defineDialog('EditViewDialog', EditViewDialogContent, {
  width: 1060,
  height: 700,
  minWidth: 640,
  minHeight: 420,
});
