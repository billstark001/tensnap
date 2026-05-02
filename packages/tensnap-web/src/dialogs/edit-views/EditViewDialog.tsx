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

interface EditViewDialogProps extends DialogOpenProps {
  view: AnyView;
  onSave: (updatedView: AnyView, objectData?: any) => void;
}

const cloneView = (nextView: AnyView): AnyView => ({
  ...nextView,
  data: nextView.data ? structuredClone(nextView.data) : nextView.data,
} as AnyView);

const dangerousKeys: readonly string[] = ['__proto__', 'constructor', 'prototype'] as const;

export const EditViewDialog: React.FC<EditViewDialogProps> = ({
  open,
  onOpenChange,
  view,
  onSave,
}) => {
  const [localView, setLocalView] = useState<AnyView>(view);
  const [localObjectData, setLocalObjectData] = useState<Parameter | any | ChartGroup | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const parameters = useScenarioStore((store) => store.parameters);
  const environments = useScenarioStore((store) => store.environments);
  const charts = useScenarioStore((store) => store.charts);


  useEffect(() => {
    if (!open) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect 
    setLocalView(cloneView(view));
    setHasChanges(false);

    // Load the associated object data for anchored views
    if (view.type === 'parameter' || view.type === 'environment' || view.type === 'chart') {
      const anchoredView = view as AnchoredView;
      if (view.type === 'parameter') {
        const param = parameters?.get(anchoredView.data.id);
        setLocalObjectData(param ? { ...param } : null);
      } else if (view.type === 'environment') {
        setLocalObjectData(getEditableEnvironmentData(environments, anchoredView.data.id));
      } else if (view.type === 'chart') {
        const chart = charts?.getGroup(anchoredView.data.id);
        setLocalObjectData(chart ? { ...chart } : null);
      }
    } else {
      setLocalObjectData(null);
    }
  }, [view, open, parameters, environments, charts]);


  const setNestedValue = useCallback((target: Record<string, any>, path: string[], value: any): boolean => {
    if (path.some((part) => dangerousKeys.includes(part))) {
      console.warn('Attempted to set dangerous property:', path.join('.'));
      return false;
    }

    let current: Record<string, any> = target;
    for (let index = 0; index < path.length - 1; index += 1) {
      const part = path[index];
      if (!Object.prototype.hasOwnProperty.call(current, part) || typeof current[part] !== 'object' || current[part] === null) {
        current[part] = {};
      }
      current = current[part];
    }

    const lastPart = path[path.length - 1];
    current[lastPart] = value;
    return true;
  }, []);

  const handleChange = useCallback((field: string, value: any) => {
    setLocalView((prev) => {
      const updated = cloneView(prev);
      if (field.startsWith('data.')) {
        const dataField = field.substring(5);
        const nextData = structuredClone(prev.data ?? {});
        if (!setNestedValue(nextData as Record<string, any>, dataField.split('.'), value)) {
          return prev;
        }
        updated.data = nextData as typeof prev.data;
      } else {
        (updated as any)[field] = value;
      }
      return updated;
    });
    setHasChanges(true);
  }, [setNestedValue]);

  const handleObjectChange = useCallback((field: string, value: any) => {
    setLocalObjectData((prev: any) => {
      if (!prev) return null;
      const updated = { ...prev };
      if (field.includes('.')) {
        if (!setNestedValue(updated, field.split('.'), value)) {
          return prev;
        }
      } else {
        if (!dangerousKeys.includes(field)) {
          (updated as any)[field] = value;
        } else {
          console.warn('Attempted to set dangerous property:', field);
          return prev;
        }
      }
      return updated;
    });
    setHasChanges(true);
  }, [setNestedValue]);

  const handleSave = useCallback(() => {
    onSave(localView, localView.type === 'environment' ? undefined : localObjectData);
    setHasChanges(false);
    onOpenChange?.(false);
  }, [localView, localObjectData, onSave, onOpenChange]);

  const handleReset = useCallback(() => {
    setLocalView(cloneView(view));
    setHasChanges(false);

    // Reset object data
    if (view.type === 'parameter' || view.type === 'environment' || view.type === 'chart') {
      const anchoredView = view as AnchoredView;
      if (view.type === 'parameter') {
        const param = parameters?.get(anchoredView.data.id);
        setLocalObjectData(param ? { ...param } : null);
      } else if (view.type === 'environment') {
        setLocalObjectData(getEditableEnvironmentData(environments, anchoredView.data.id));
      } else if (view.type === 'chart') {
        const chart = charts?.getGroup(anchoredView.data.id);
        setLocalObjectData(chart ? { ...chart } : null);
      }
    }
  }, [view, parameters, environments, charts]);

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
      <Dialog.Description></Dialog.Description>

      <Dialog.Body>
        {renderEditor()}
      </Dialog.Body>

      <Dialog.Footer>
        <Dialog.Button onClick={handleReset} disabled={!hasChanges}>
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
