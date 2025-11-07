import React, { useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as dialogStyles from '@/styles/dialog.css';
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
      <Dialog.Portal>
        <Dialog.Overlay className={dialogStyles.dialogOverlay} />
        <Dialog.Content className={dialogStyles.dialogContent}>
          <Dialog.Title className={dialogStyles.dialogTitle}><Trans>Create New Project</Trans></Dialog.Title>
          <Dialog.Description></Dialog.Description>
          <div>
            <fieldset className={dialogStyles.dialogFieldset}>
              <label className={dialogStyles.dialogLabel}><Trans>Backend URL</Trans></label>
              <input
                type="text"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                className={dialogStyles.dialogInput}
                placeholder={_(msg`Enter backend WebSocket server address`)}
                onKeyDown={handleKeyDown}
              />
            </fieldset>
          </div>
          <div className={dialogStyles.dialogFooter}>
            <Dialog.Close asChild>
              <button className={dialogStyles.dialogButton}><Trans>Cancel</Trans></button>
            </Dialog.Close>
            <button
              className={dialogStyles.dialogButtonPrimary}
              onClick={handleCreateItem}
              disabled={!newItemName.trim()}
            >
              <Trans>Create</Trans>
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
