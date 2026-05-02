import React, { useState, useCallback, useMemo } from 'react';
import * as Dialog from '@tensnap/web-common/components/ui/Dialog';
import { DialogOpenProps } from '@tensnap/web-common/react';
import { msg } from '@lingui/macro';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import Form from '@tensnap/web-common/components/ui/Form';
import { listBuiltinModels, makeInMemoryConnectionId } from '@/transport';
import * as styles from './CreateNewProjectDialog.css';


const FakeModelCard: React.FC<{
  model: { id: string; name: string; description: string };
  onSelect: (model: { id: string; name: string; description: string }) => void;
}> = ({ model, onSelect }) => (
  <div
    onClick={() => onSelect(model)}
    className={styles.fakeModelCardContainer}
  >
    <h3 className={styles.fakeModelTitle}>
      {model.name}
    </h3>
    <p className={styles.fakeModelDescription}>
      {model.description}
    </p>
  </div>
);


export interface CreateNewDialogProps extends DialogOpenProps {
  onCreateItem: (name: string) => void;
}

export const CreateNewProjectDialog: React.FC<CreateNewDialogProps> = ({
  open: isOpen,
  onOpenChange,
  onCreateItem
}) => {
  const { _ } = useLingui();
  const [newItemName, setNewItemName] = useState('http://localhost:8765');

  const handleCreateItem = useCallback(() => {
    if (!newItemName.trim()) return;

    try {
      onCreateItem(newItemName);
      onOpenChange?.(false);
    } catch (error) {
      console.error('Failed to create item:', error);
    }
  }, [newItemName, onCreateItem, onOpenChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCreateItem();
    }
  }, [handleCreateItem]);

  const fakeModels = useMemo(() => listBuiltinModels(), []);

  return (
    <Dialog.Root open={isOpen} onOpenChange={onOpenChange} size='lg'>
      <Dialog.Title><Trans>Create New Project</Trans></Dialog.Title>
      <Dialog.Description></Dialog.Description>
      <Dialog.Body>
        <Form.FieldSet>
          <Form.Label><Trans>Backend URL</Trans></Form.Label>
          <Form.Input
            type="text"
            value={newItemName}
            onChange={(e) => setNewItemName(e.target.value)}
            placeholder={_(msg`Enter backend WebSocket server address`)}
            onKeyDown={handleKeyDown}
          />
        </Form.FieldSet>

        <Dialog.Separator />

        {fakeModels.length > 0 && <div
          className={styles.fakeModelSection}
        >
          <h4 className={styles.fakeModelSectionTitle}>
            <Trans>Or select a built-in model that runs in the browser:</Trans>
          </h4>
          {fakeModels.map((model) => (
            <FakeModelCard
              key={model.id}
              model={model}
              onSelect={() => {
                onCreateItem(makeInMemoryConnectionId(model.id));
                onOpenChange?.(false);
              }}
            />
          ))}
        </div>}
      </Dialog.Body>

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