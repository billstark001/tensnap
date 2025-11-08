import React, { useState, useCallback } from 'react';
import * as Dialog from '@/components/ui/Dialog';
import * as formStyles from '@/styles/form.css';
import { DialogOpenProps } from '@/utils/react';
import { msg } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';

export interface CreateNewDialogProps extends DialogOpenProps {
  onCreateItem: (name: string) => void;
}

export const CreateNewDialog: React.FC<CreateNewDialogProps> = ({
  open: isOpen,
  onOpenChange,
  onCreateItem
}) => {
  const { _ } = useLingui();
  const [newItemName, setNewItemName] = useState('http://localhost:5678');

  const handleCreateItem = useCallback(() => {
    if (!newItemName.trim()) return;

    try {
      onCreateItem(newItemName);
      onOpenChange?.(false);
      setNewItemName('');
    } catch (error) {
      console.error('Failed to create item:', error);
    }
  }, [newItemName, onCreateItem, onOpenChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCreateItem();
    }
  }, [handleCreateItem]);

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Title><Trans>Create New Project</Trans></Dialog.Title>
      <Dialog.Description></Dialog.Description>
      <div>
        <fieldset className={formStyles.formFieldSet}>
          <label className={formStyles.formLabel}><Trans>Backend URL</Trans></label>
          <input
            type="text"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            className={formStyles.formInput}
            placeholder={_(msg`Enter backend WebSocket server address`)}
            onKeyDown={handleKeyDown}
          />
        </fieldset>
      </div>
      <Dialog.Footer>
        <Dialog.Close asChild>
          <Dialog.Button><Trans>Cancel</Trans></Dialog.Button>
        </Dialog.Close>
        <Dialog.Button
          variant="primary"
          onClick={handleCreateItem}
          disabled={!newItemName.trim()}
        >
          <Trans>Create</Trans>
        </Dialog.Button>
      </Dialog.Footer>
    </Dialog.Root>
  );
};
