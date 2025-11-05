import React, { useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as dialogStyles from 'tensnap-web/styles/dialog.css';
import { DialogOpenProps, useCallbackRef } from 'tensnap-web/utils/react';

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
      <Dialog.Portal>
        <Dialog.Overlay className={dialogStyles.dialogOverlay} />
        <Dialog.Content className={dialogStyles.dialogContent}>
          <Dialog.Title className={dialogStyles.dialogTitle}>创建新项目</Dialog.Title>
          <Dialog.Description></Dialog.Description>
          <div>
            <fieldset className={dialogStyles.dialogFieldset}>
              <label className={dialogStyles.dialogLabel}>类型</label>
              <select 
                value={newItemType}
                onChange={(e) => setNewItemType(e.target.value as 'file' | 'directory')}
                className={dialogStyles.dialogInput}
              >
                <option value="file">文件</option>
                <option value="directory">目录</option>
              </select>
            </fieldset>
            <fieldset className={dialogStyles.dialogFieldset}>
              <label className={dialogStyles.dialogLabel}>名称</label>
              <input
                type="text"
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                className={dialogStyles.dialogInput}
                placeholder={`输入${newItemType === 'file' ? '文件' : '目录'}名称`}
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
