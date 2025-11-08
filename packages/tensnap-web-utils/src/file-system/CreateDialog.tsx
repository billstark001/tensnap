import React, { useState, useCallback } from 'react';
import * as Dialog from 'tensnap-web/components/ui/Dialog';
import * as formStyles from 'tensnap-web/styles/form.css';
import { DialogOpenProps, useCallbackRef } from 'tensnap-web/utils';

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
      <Dialog.Title>创建新项目</Dialog.Title>
      <Dialog.Description></Dialog.Description>
      <div>
        <fieldset className={formStyles.formFieldSet}>
          <label className={formStyles.formLabel}>类型</label>
          <select
            value={newItemType}
            onChange={(e) => setNewItemType(e.target.value as 'file' | 'directory')}
            className={formStyles.formInput}
          >
            <option value="file">文件</option>
            <option value="directory">目录</option>
          </select>
        </fieldset>
        <fieldset className={formStyles.formFieldSet}>
          <label className={formStyles.formLabel}>名称</label>
          <input
            type="text"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            className={formStyles.formInput}
            placeholder={`输入${newItemType === 'file' ? '文件' : '目录'}名称`}
            onKeyDown={handleKeyDown}
          />
        </fieldset>
      </div>
      <Dialog.Footer>
        <Dialog.Close asChild>
          <Dialog.Button>取消</Dialog.Button>
        </Dialog.Close>
        <Dialog.Button
          variant="primary"
          onClick={handleCreateItem}
          disabled={!newItemName.trim()}
        >
          创建
        </Dialog.Button>
      </Dialog.Footer>
    </Dialog.Root>
  );
};
