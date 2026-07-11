import React, { useState, useCallback, useEffect, useMemo } from 'react';
import * as Dialog from '@tensnap/web-common/components/ui/Dialog';
import { AnyView, ButtonView, AnchoredView, ContainerView } from '@/types/ui';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { DialogOpenProps } from '@tensnap/web-common/react';
import { ButtonViewEditor } from './ButtonViewEditor';
import { ContainerViewEditor } from './ContainerViewEditor';
import { EnvironmentViewEditor } from './EnvironmentViewEditor';
import { ParameterViewEditor } from './ParameterViewEditor';
import { ChartViewEditor } from './ChartViewEditor';
import { useScenarioStore } from '@/store/scenario/store';
import { Action, Parameter, ChartGroup, ParameterType } from '@/types/model';
import { EditObjectIdDialog } from './EditObjectIdDialog';
import { ConfirmEditDialog } from './ConfirmEditDialog';
import { useToast } from '@/store';
import {
  EditableObjectData,
  EditableObjectKind,
  getBoundObjectId,
  getEditableObjectData,
  getEditableObjectKind,
  getObjectIdConflict,
  normalizeEnvironmentForType,
  normalizeParameterForType,
  ScenarioDataSources,
  withBoundObjectId,
  withObjectDataId,
} from './edit-view-model';
import type { EditableEnvironmentData } from './environment-editor-model';

interface EditViewDialogProps extends DialogOpenProps {
  view: AnyView;
  onSave: (updatedView: AnyView, objectData?: any) => void | boolean | { ok: boolean; message?: string };
}

type ObjectIdDialogState = {
  kind: EditableObjectKind;
  currentId: string;
  objectExists: boolean;
} | null;

type StructuralEditState = {
  kind: 'parameter-type';
  value: ParameterType;
} | {
  kind: 'environment-type';
  value: EditableEnvironmentData['type'];
} | null;

const DATA_FIELD_PREFIX = 'data.';
const DANGEROUS_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'] as const;
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

const getObjectDataForSave = (view: AnyView, objectData: EditableObjectData): EditableObjectData | undefined => (
  getEditableObjectKind(view) ? objectData ?? undefined : undefined
);

export const EditViewDialog: React.FC<EditViewDialogProps> = ({
  open,
  onOpenChange,
  view,
  onSave,
}) => {
  const { _ } = useLingui();
  const [localView, setLocalView] = useState<AnyView>(() => cloneView(view));
  const [localObjectData, setLocalObjectData] = useState<EditableObjectData>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [editorRevision, setEditorRevision] = useState(0);
  const [objectIdDialog, setObjectIdDialog] = useState<ObjectIdDialogState>(null);
  const [structuralEdit, setStructuralEdit] = useState<StructuralEditState>(null);

  const actions = useScenarioStore((store) => store.actions);
  const parameters = useScenarioStore((store) => store.parameters);
  const environments = useScenarioStore((store) => store.environments);
  const charts = useScenarioStore((store) => store.charts);
  const sources: ScenarioDataSources = useMemo(
    () => ({ actions, parameters, environments, charts }),
    [actions, charts, environments, parameters],
  );

  const resetLocalState = useCallback(() => {
    setLocalView(cloneView(view));
    setLocalObjectData(getEditableObjectData(view, { actions, parameters, environments, charts }));
    setHasChanges(false);
    setEditorRevision((revision) => revision + 1);
  }, [actions, charts, environments, parameters, view]);

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

  const handleEditObjectId = useCallback(() => {
    const kind = getEditableObjectKind(localView);
    if (!kind) {
      return;
    }
    setObjectIdDialog({
      kind,
      currentId: getBoundObjectId(localView),
      objectExists: Boolean(localObjectData),
    });
  }, [localObjectData, localView]);

  const validateObjectId = useCallback((nextId: string): string | null => {
    if (!objectIdDialog) {
      return null;
    }

    if (getObjectIdConflict(
      objectIdDialog.kind,
      objectIdDialog.currentId,
      nextId,
      objectIdDialog.objectExists,
      sources,
    )) {
      return _(msg`This ID is already used by another registered object.`);
    }

    return null;
  }, [_, objectIdDialog, sources]);

  const handleSubmitObjectId = useCallback((nextId: string) => {
    const nextView = withBoundObjectId(localView, nextId);
    setLocalView(nextView);
    setLocalObjectData((prev) => {
      if (prev) {
        return withObjectDataId(prev, nextId);
      }
      return getEditableObjectData(nextView, sources);
    });
    setHasChanges(true);
    setEditorRevision((revision) => revision + 1);
  }, [localView, sources]);

  const requestParameterTypeChange = useCallback((value: ParameterType) => {
    if ((localObjectData as Parameter | null)?.type === value) {
      return;
    }
    setStructuralEdit({ kind: 'parameter-type', value });
  }, [localObjectData]);

  const requestEnvironmentTypeChange = useCallback((value: EditableEnvironmentData['type']) => {
    if ((localObjectData as EditableEnvironmentData | null)?.type === value) {
      return;
    }
    setStructuralEdit({ kind: 'environment-type', value });
  }, [localObjectData]);

  const applyStructuralEdit = useCallback(() => {
    if (!structuralEdit) {
      return;
    }

    if (structuralEdit.kind === 'parameter-type') {
      setLocalObjectData((prev) => (
        prev ? normalizeParameterForType(prev as Parameter, structuralEdit.value) : prev
      ));
      setLocalView((prev) => updateViewField(prev, 'data.type', structuralEdit.value, toast.warning));
    } else {
      setLocalObjectData((prev) => (
        prev ? normalizeEnvironmentForType(prev as EditableEnvironmentData, structuralEdit.value) : prev
      ));
      setLocalView((prev) => updateViewField(prev, 'data.type', structuralEdit.value, toast.warning));
    }

    setHasChanges(true);
    setEditorRevision((revision) => revision + 1);
  }, [structuralEdit, toast.warning]);

  const handleSave = useCallback(() => {
    const result = onSave(localView, getObjectDataForSave(localView, localObjectData));
    if (typeof result === 'object' && result && 'ok' in result && !result.ok) {
      return;
    }
    if (result === false) {
      return;
    }
    setHasChanges(false);
    onOpenChange?.(false);
  }, [localView, localObjectData, onSave, onOpenChange]);

  const renderEditor = () => {
    switch (localView.type) {
      case 'button':
        return <ButtonViewEditor
          view={localView as ButtonView}
          objectData={localObjectData as Action | null}
          onChange={handleChange}
          onObjectChange={handleObjectChange}
          onEditObjectId={handleEditObjectId}
        />;
      case 'container':
        return <ContainerViewEditor view={localView as ContainerView} onChange={handleChange} />;
      case 'environment':
        return <EnvironmentViewEditor
          view={localView as AnchoredView}
          objectData={localObjectData as any}
          onChange={handleChange}
          onObjectChange={handleObjectChange}
          onEditObjectId={handleEditObjectId}
          onRequestTypeChange={requestEnvironmentTypeChange}
        />;
      case 'parameter':
        return <ParameterViewEditor
          view={localView as AnchoredView}
          objectData={localObjectData as Parameter}
          onChange={handleChange}
          onObjectChange={handleObjectChange}
          onEditObjectId={handleEditObjectId}
          onRequestTypeChange={requestParameterTypeChange}
        />;
      case 'chart':
        return <ChartViewEditor
          view={localView as AnchoredView}
          objectData={localObjectData as ChartGroup}
          onChange={handleChange}
          onObjectChange={handleObjectChange}
          onEditObjectId={handleEditObjectId}
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
        <React.Fragment key={editorRevision}>
          {renderEditor()}
        </React.Fragment>
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

      <EditObjectIdDialog
        key={objectIdDialog ? `${objectIdDialog.kind}:${objectIdDialog.currentId}` : 'closed'}
        open={Boolean(objectIdDialog)}
        title={<Trans>Edit Object ID</Trans>}
        currentId={objectIdDialog?.currentId ?? ''}
        objectExists={objectIdDialog?.objectExists ?? false}
        validateId={validateObjectId}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setObjectIdDialog(null);
          }
        }}
        onSubmit={handleSubmitObjectId}
      />

      <ConfirmEditDialog
        open={Boolean(structuralEdit)}
        title={<Trans>Confirm Structural Change</Trans>}
        description={
          <Trans>This change may alter how the object is interpreted. Existing data will be preserved where possible.</Trans>
        }
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setStructuralEdit(null);
          }
        }}
        onConfirm={applyStructuralEdit}
      />
    </Dialog.Root>
  );
};
