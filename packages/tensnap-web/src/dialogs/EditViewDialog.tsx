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

interface EditViewDialogProps extends DialogOpenProps {
  view: AnyView;
  onSave: (updatedView: AnyView) => void;
}

export const EditViewDialog: React.FC<EditViewDialogProps> = ({
  open,
  onOpenChange,
  view,
  onSave,
}) => {
  const [localView, setLocalView] = useState<AnyView>(view);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setLocalView(view);
    setHasChanges(false);
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

  const handleSave = useCallback(() => {
    onSave(localView);
    setHasChanges(false);
    onOpenChange?.(false);
  }, [localView, onSave, onOpenChange]);

  const handleReset = useCallback(() => {
    setLocalView(view);
    setHasChanges(false);
  }, [view]);

  const renderEditor = () => {
    switch (localView.type) {
      case 'button':
        return <ButtonViewEditor view={localView as ButtonView} onChange={handleChange} />;
      case 'container':
        return <ContainerViewEditor view={localView as ContainerView} onChange={handleChange} />;
      case 'environment':
        return <EnvironmentViewEditor view={localView as AnchoredView} onChange={handleChange} />;
      case 'parameter':
        return <ParameterViewEditor view={localView as AnchoredView} onChange={handleChange} />;
      case 'chart':
        return <ChartViewEditor view={localView as AnchoredView} onChange={handleChange} />;
      default:
        return null;
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
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
