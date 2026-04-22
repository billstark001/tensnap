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
import type { ScenarioEnvironmentState } from '@tensnap/core';

type EditableEnvironmentData = {
  id: string;
  type: string;
  width?: number;
  height?: number;
  coord_offset?: string;
  show_grid?: boolean;
  background_color?: string;
};

const getEditableEnvironmentData = (environments: ReadonlyMap<string, ScenarioEnvironmentState> | undefined, id: string): EditableEnvironmentData | null => {
  if (!environments) {
    return null;
  }

  const env = environments.get(id);
  if (!env) {
    return null;
  }

  const layers = [...env.layers.values()];
  const gridLayer = layers.find((layer) => (
    layer.layerType === 'grid'
    || (typeof layer.metadata?.width === 'number' && typeof layer.metadata?.height === 'number')
  ));
  const agentLayer = layers.find((layer) => layer.layerType === 'agent');
  const gridMetadata = (gridLayer?.metadata ?? {}) as Record<string, unknown>;
  const agentMetadata = (agentLayer?.metadata ?? {}) as Record<string, unknown>;

  return {
    id: env.id,
    type: env.type,
    width: typeof gridMetadata.width === 'number' ? gridMetadata.width : undefined,
    height: typeof gridMetadata.height === 'number' ? gridMetadata.height : undefined,
    coord_offset: typeof agentMetadata.coord_offset === 'string' ? agentMetadata.coord_offset : undefined,
    show_grid: typeof gridMetadata.show_grid === 'boolean' ? gridMetadata.show_grid : undefined,
    background_color: typeof gridMetadata.background_color === 'string' ? gridMetadata.background_color : undefined,
  };
};

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
    if (!open) {
      return;
    }

    setLocalView({ ...view });
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
  }, [view, open]);

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
        
        // Guard against prototype pollution
        const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
        if (parts.some(part => dangerousKeys.includes(part))) {
          console.warn('Attempted to set dangerous property:', field);
          return prev;
        }
        
        let current: any = updated;
        for (let i = 0; i < parts.length - 1; i++) {
          const part = parts[i];
          if (!Object.prototype.hasOwnProperty.call(current, part)) {
            current[part] = {};
          }
          current = current[part];
        }
        const lastPart = parts[parts.length - 1];
        if (!dangerousKeys.includes(lastPart)) {
          current[lastPart] = value;
        }
      } else {
        // Guard against prototype pollution
        const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
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
