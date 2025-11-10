import React, { useState, useCallback, useEffect } from 'react';
import * as Dialog from '@/components/ui/Dialog';
import { AnyView, ButtonView, AnchoredView, ContainerView } from '@/types/ui';
import { Trans } from '@lingui/react/macro';
import { DialogOpenProps } from '@/utils/react';
import { ButtonViewEditor } from './edit-views/ButtonViewEditor';
import { ContainerViewEditor } from './edit-views/ContainerViewEditor';
import { EnvironmentViewEditor } from './edit-views/EnvironmentViewEditor';
import { ParameterViewEditor } from './edit-views/ParameterViewEditor';
import { ChartViewEditor } from './edit-views/ChartViewEditor';
import { useScenarioStore } from '@/store/scenario/store';
import { Parameter, ChartGroup } from '@/types/model';

interface EditViewDialogProps extends DialogOpenProps {
  view: AnyView;
  onSave: (updatedView: AnyView, objectData?: any) => void;
}

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
    setLocalView({ ...view });
    setHasChanges(false);

    // Load the associated object data for anchored views
    if (view.type === 'parameter' || view.type === 'environment' || view.type === 'chart') {
      const anchoredView = view as AnchoredView;
      if (view.type === 'parameter') {
        const param = parameters?.find(p => p.id === anchoredView.data.id);
        setLocalObjectData(param ? { ...param } : null);
      } else if (view.type === 'environment') {
        const env = environments?.get(anchoredView.data.id);
        setLocalObjectData(env ? { ...env } : null);
      } else if (view.type === 'chart') {
        const chart = charts?.allChartGroups.get(anchoredView.data.id);
        setLocalObjectData(chart ? { ...chart } : null);
      }
    } else {
      setLocalObjectData(null);
    }
  }, [view, open, parameters, environments, charts]);

  const handleChange = useCallback((field: string, value: any) => {
    setLocalView((prev) => {
      const updated = { ...prev };
      if (field.startsWith('data.')) {
        const dataField = field.substring(5);
        updated.data = { ...prev.data, [dataField]: value };
      } else {
        (updated as any)[field] = value;
      }
      return updated;
    });
    setHasChanges(true);
  }, []);

  const handleObjectChange = useCallback((field: string, value: any) => {
    setLocalObjectData((prev: any) => {
      if (!prev) return null;
      const updated = { ...prev };
      if (field.includes('.')) {
        const parts = field.split('.');
        let current: any = updated;
        for (let i = 0; i < parts.length - 1; i++) {
          if (!current[parts[i]]) {
            current[parts[i]] = {};
          }
          current = current[parts[i]];
        }
        current[parts[parts.length - 1]] = value;
      } else {
        (updated as any)[field] = value;
      }
      return updated;
    });
    setHasChanges(true);
  }, []);

  const handleSave = useCallback(() => {
    onSave(localView, localObjectData);
    setHasChanges(false);
    onOpenChange?.(false);
  }, [localView, localObjectData, onSave, onOpenChange]);

  const handleReset = useCallback(() => {
    setLocalView(view);
    setHasChanges(false);
    
    // Reset object data
    if (view.type === 'parameter' || view.type === 'environment' || view.type === 'chart') {
      const anchoredView = view as AnchoredView;
      if (view.type === 'parameter') {
        const param = parameters?.find(p => p.id === anchoredView.data.id);
        setLocalObjectData(param ? { ...param } : null);
      } else if (view.type === 'environment') {
        const env = environments?.get(anchoredView.data.id);
        setLocalObjectData(env ? { ...env } : null);
      } else if (view.type === 'chart') {
        const chart = charts?.allChartGroups.get(anchoredView.data.id);
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
