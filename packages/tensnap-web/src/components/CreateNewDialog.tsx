import React, { useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as dialogStyles from '@/styles/dialog.css';

export interface CreateNewDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateItem: (name: string) => void;
}

export const CreateNewDialog: React.FC<CreateNewDialogProps> = ({
  isOpen,
  onOpenChange,
  onCreateItem
}) => {
  const [newItemName, setNewItemName] = useState('http://localhost:5678');

  const handleCreateItem = useCallback(async () => {
    if (!newItemName.trim()) return;

    try {
      await onCreateItem(newItemName);
      onOpenChange(false);
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
          <Dialog.Title className={dialogStyles.dialogTitle}>创建新项目</Dialog.Title>
          <Dialog.Description></Dialog.Description>
          <div>
            <fieldset className={dialogStyles.dialogFieldset}>
              <label className={dialogStyles.dialogLabel}>后端地址</label>
              <input
                type="text"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                className={dialogStyles.dialogInput}
                placeholder="输入后端WebSocket服务器地址"
                onKeyDown={handleKeyDown}
              />
            </fieldset>
          </div>
          <div className={dialogStyles.dialogFooter}>
            <Dialog.Close asChild>
              <button className={dialogStyles.dialogButton}>取消</button>
            </Dialog.Close>
            <button 
              className={dialogStyles.dialogButtonPrimary}
              onClick={handleCreateItem}
              disabled={!newItemName.trim()}
            >
              创建
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
