import React, { useState, useCallback } from 'react';
import * as Dialog from 'tensnap-web/components/ui/Dialog';
import * as Form from 'tensnap-web/components/ui/Form';

import { DialogOpenProps, useCallbackRef } from 'tensnap-web/utils';
import { Trans } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';

export interface CreateDialogProps extends DialogOpenProps {
  onCreateItem: (name: string, type: 'file' | 'directory') => Promise<void>;
}

export const CreateDialog: React.FC<CreateDialogProps> = ({
  open: isOpen,
  onOpenChange: _onOpenChange,
  onCreateItem
}) => {
  const [newItemName, setNewItemName] = useState('');
  const [newItemType, setNewItemType] = useState<'file' | 'directory'>('file');
  const { _ } = useLingui();

  const onOpenChange = useCallbackRef(_onOpenChange);

  const handleCreateItem = useCallback(async () => {
    if (!newItemName.trim()) return;

    try {
      await onCreateItem(newItemName, newItemType);
      onOpenChange(false);
      setNewItemName('');
    } catch (error) {
      console.error('Failed to create item:', error);
    }
  }, [newItemName, newItemType, onCreateItem, onOpenChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCreateItem();
    }
  }, [handleCreateItem]);

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <Dialog.Title><Trans>Create New Item</Trans></Dialog.Title>
      <Dialog.Description></Dialog.Description>
      <div>
        <Form.FieldSet>
          <Form.Label><Trans>Type</Trans></Form.Label>
          <Form.Select
            value={newItemType}
            onChange={(e) => setNewItemType(e.target.value as 'file' | 'directory')}
          >
            <option value="file">{_(msg`File`)}</option>
            <option value="directory">{_(msg`Directory`)}</option>
          </Form.Select>
        </Form.FieldSet>
        <Form.FieldSet>
          <Form.Label><Trans>Name</Trans></Form.Label>
          <Form.Input
            type="text"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            placeholder={newItemType === 'file' ? _(msg`Enter file name`) : _(msg`Enter directory name`)}
            onKeyDown={handleKeyDown}
          />
        </Form.FieldSet>
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
