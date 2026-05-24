import React, { useState, useCallback, useEffect } from 'react';
import * as Dialog from '@tensnap/web-common/components/ui/Dialog';
import { AnyView, ButtonView, AnchoredView, ContainerView } from '@/types/ui';
import { Trans } from '@lingui/react/macro';
import { DialogOpenProps } from '@tensnap/web-common/react';
import { ButtonViewEditor } from './ButtonViewEditor';
import { ContainerViewEditor } from './ContainerViewEditor';
import { EnvironmentViewEditor } from './EnvironmentViewEditor';
import { ParameterViewEditor } from './ParameterViewEditor';
import { ChartViewEditor } from './ChartViewEditor';
import { useScenarioStore } from '@/store/scenario/store';
import { Parameter, ChartGroup } from '@/types/model';
import { getEditableEnvironmentData } from './environment-editor-model';
import { useToast } from '@/store';

interface EditViewDialogProps extends DialogOpenProps {
  view: AnyView;
  onSave: (updatedView: AnyView, objectData?: any) => void;
}

type EditableObjectData = Parameter | ChartGroup | any | null;
type ScenarioDataSources = {
  parameters: any;
  environments: any;
  charts: any;
};

const DATA_FIELD_PREFIX = 'data.';
const DANGEROUS_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'] as const;
const EDITABLE_OBJECT_VIEW_TYPES = new Set<AnyView['type']>(['parameter', 'environment', 'chart']);

const cloneView = (nextView: AnyView): AnyView => ({
  ...nextView,
  data: nextView.data ? structuredClone(nextView.data) : nextView.data,
} as AnyView);

const isSafePath = (path: readonly string[]): boolean => !path.some((part) => DANGEROUS_KEYS.includes(part));

type Warn = (msg: string) => void;

const warnUnsafePath = (path: readonly string[], warn?: Warn): void => {
  if (!warn) {
    warn = console.warn;
  }
  warn('Attempted to set dangerous property: ' + path.join('.'));
};

const setNestedValue = (target: Record<string, any>, path: readonly string[], value: any, warn?: Warn): boolean => {
  if (path.length === 0) {
    return false;
  }

  if (!isSafePath(path)) {
    warnUnsafePath(path, warn);
    return false;
  }

  let current = target;
  for (let index = 0; index < path.length - 1; index += 1) {
    const part = path[index];
    if (!Object.prototype.hasOwnProperty.call(current, part) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part];
  }

  current[path[path.length - 1]] = value;
  return true;
};

const setFieldValue = <T extends Record<string, any>>(target: T, field: keyof T & string, value: any, warn?: Warn): boolean => {
  const path = field.split('.');
  if (path.length > 1) {
    return setNestedValue(target, path, value, warn);
  }

  if (!isSafePath(path)) {
    warnUnsafePath(path, warn);
    return false;
  }

  target[field] = value;
  return true;
};

const updateViewField = (view: AnyView, field: string, value: any, warn?: Warn): AnyView => {
  const updated = cloneView(view);

  if (!field.startsWith(DATA_FIELD_PREFIX)) {
    return setFieldValue(updated as Record<string, any>, field, value, warn) ? updated : view;
  }

  const nextData = structuredClone(view.data ?? {});
  const dataPath = field.slice(DATA_FIELD_PREFIX.length).split('.');
  if (!setNestedValue(nextData as Record<string, any>, dataPath, value, warn)) {
    return view;
  }

  updated.data = nextData as typeof view.data;
  return updated;
};

const updateObjectField = <T extends Record<string, any>>(objectData: T | null, field: string, value: any, warn?: Warn): T | null => {
  if (!objectData) {
    return null;
  }

  const updated = structuredClone(objectData);
  return setFieldValue(updated, field, value, warn) ? updated : objectData;
};

const getEditableObjectData = (view: AnyView, sources: ScenarioDataSources): EditableObjectData => {
  if (!EDITABLE_OBJECT_VIEW_TYPES.has(view.type)) {
    return null;
  }

  const id = (view as AnchoredView).data.id;

  switch (view.type) {
    case 'parameter': {
      const parameter = sources.parameters?.get(id);
      return parameter ? { ...parameter } : null;
    }
    case 'environment':
      return getEditableEnvironmentData(sources.environments, id);
    case 'chart': {
      const chart = sources.charts?.getGroup(id);
      return chart ? { ...chart } : null;
    }
    default:
      return null;
  }
};

const getObjectDataForSave = (view: AnyView, objectData: EditableObjectData): EditableObjectData | undefined => (
  view.type === 'environment' ? undefined : objectData
);

export const EditViewDialog: React.FC<EditViewDialogProps> = ({
  open,
  onOpenChange,
  view,
  onSave,
}) => {
  const [localView, setLocalView] = useState<AnyView>(() => cloneView(view));
  const [localObjectData, setLocalObjectData] = useState<EditableObjectData>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const parameters = useScenarioStore((store) => store.parameters);
  const environments = useScenarioStore((store) => store.environments);
  const charts = useScenarioStore((store) => store.charts);

  const resetLocalState = useCallback(() => {
    setLocalView(cloneView(view));
    setLocalObjectData(getEditableObjectData(view, { parameters, environments, charts }));
    setHasChanges(false);
  }, [charts, environments, parameters, view]);

  useEffect(() => {
    if (!open) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    resetLocalState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toast = useToast();

  const handleChange = useCallback((field: string, value: any) => {
    setLocalView((prev) => updateViewField(prev, field, value, toast.warning));
    setHasChanges(true);
  }, [toast.warning]);

  const handleObjectChange = useCallback((field: string, value: any) => {
    setLocalObjectData((prev: any) => updateObjectField(prev, field, value, toast.warning));
    setHasChanges(true);
  }, [toast.warning]);

  const handleSave = useCallback(() => {
    onSave(localView, getObjectDataForSave(localView, localObjectData));
    setHasChanges(false);
    onOpenChange?.(false);
  }, [localView, localObjectData, onSave, onOpenChange]);

  const renderEditor = () => {
    switch (localView.type) {
      case 'button':
        return <ButtonViewEditor view={localView as ButtonView} onChange={handleChange} />;
      case 'container':
        return <ContainerViewEditor view={localView as ContainerView} onChange={handleChange} />;
      case 'environment':
        return <EnvironmentViewEditor
          view={localView as AnchoredView}
          objectData={localObjectData as any}
          onChange={handleChange}
          onObjectChange={handleObjectChange}
        />;
      case 'parameter':
        return <ParameterViewEditor
          view={localView as AnchoredView}
          objectData={localObjectData as Parameter}
          onChange={handleChange}
          onObjectChange={handleObjectChange}
        />;
      case 'chart':
        return <ChartViewEditor
          view={localView as AnchoredView}
          objectData={localObjectData as ChartGroup}
          onChange={handleChange}
          onObjectChange={handleObjectChange}
        />;
      default:
        return null;
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} size="xl">
      <Dialog.CloseButton />
      <Dialog.Title><Trans>Edit View</Trans></Dialog.Title>
      <Dialog.Description />

      <Dialog.Body>
        {renderEditor()}
      </Dialog.Body>

      <Dialog.Footer>
        <Dialog.Button onClick={resetLocalState} disabled={!hasChanges}>
          <Trans>Reset</Trans>
        </Dialog.Button>
        <Dialog.Button variant="primary" onClick={handleSave} disabled={!hasChanges}>
          <Trans>Save</Trans>
        </Dialog.Button>
        <Dialog.Close asChild>
          <Dialog.Button><Trans>Cancel</Trans></Dialog.Button>
        </Dialog.Close>
      </Dialog.Footer>
    </Dialog.Root>
  );
};
