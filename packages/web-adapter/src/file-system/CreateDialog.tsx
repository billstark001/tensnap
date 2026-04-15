import React, { useState, useCallback } from 'react';
import { Dialog, Form } from '@tensnap/web/components/ui';

import { DialogOpenProps, useCallbackRef } from '@tensnap/web/utils';

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
      <Dialog.Title>Create New Item</Dialog.Title>
      <Dialog.Description></Dialog.Description>
      <div>
        <Form.FieldSet>
          <Form.Label>Type</Form.Label>
          <Form.Select
            value={newItemType}
            onChange={(e) => setNewItemType(e.target.value as 'file' | 'directory')}
          >
            <option value="file">File</option>
            <option value="directory">Directory</option>
          </Form.Select>
        </Form.FieldSet>
        <Form.FieldSet>
          <Form.Label>Name</Form.Label>
          <Form.Input
            type="text"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            placeholder={newItemType === 'file' ? 'Enter file name' : 'Enter directory name'}
            onKeyDown={handleKeyDown}
          />
        </Form.FieldSet>
      </div>
      <Dialog.Footer>
        <Dialog.Close asChild>
          <Dialog.Button>Cancel</Dialog.Button>
        </Dialog.Close>
        <Dialog.Button
          variant="primary"
          onClick={handleCreateItem}
          disabled={!newItemName.trim()}
        >
          Create
        </Dialog.Button>
      </Dialog.Footer>
    </Dialog.Root>
  );
};
