import { defineDialog } from '@tensnap/web-common/workbench/dialog-content';
import React, { useState } from 'react';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import * as Dialog from '@tensnap/web-common/components/ui/Dialog';
import Form from '@tensnap/web-common/components/ui/Form';
import { useToast } from '@/store/toast';
import * as styles from './EditViews.css';

interface EditObjectIdDialogProps {
  open: boolean;
  title: string;
  currentId: string;
  objectExists: boolean;
  validateId: (nextId: string) => string | null | Promise<string | null>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (nextId: string) => void | Promise<void>;
}

const EditObjectIdDialogContent: React.FC<EditObjectIdDialogProps> = ({
  open,
  title,
  currentId,
  objectExists,
  validateId,
  onOpenChange,
  onSubmit,
}) => {
  const { _ } = useLingui();
  const toast = useToast();
  const [draftId, setDraftId] = useState(currentId);

  const handleSubmit = async () => {
    try {
      const validationError = await validateId(draftId);
      if (validationError) {
        toast.warning(_(msg`Invalid ID`), validationError);
        return;
      }
      await onSubmit(draftId);
      onOpenChange(false);
    } catch (error) {
      toast.error(String(error));
    }
  };

  return (
    <Dialog.Root title={title} open={open} onOpenChange={onOpenChange} size="md">
      <Dialog.Description>
        <Trans>Update the object ID used by this view.</Trans>
      </Dialog.Description>

      <Dialog.Body>
        <Form.Field label={<Trans>Object ID</Trans>} htmlFor="object-id-draft">
          <Form.Input
            id="object-id-draft"
            type="text"
            value={draftId}
            onChange={(event) => setDraftId(event.target.value)}
            autoFocus
          />
          <div className={styles.fieldHint}>
            {objectExists ? (
              <Trans>The current object will be renamed when this edit is saved.</Trans>
            ) : (
              <Trans>
                No object is registered for the current ID; the view binding will be updated.
              </Trans>
            )}
          </div>
        </Form.Field>
      </Dialog.Body>

      <Dialog.Footer>
        <Dialog.Button variant="primary" onClick={handleSubmit}>
          <Trans>Apply</Trans>
        </Dialog.Button>
      </Dialog.Footer>
    </Dialog.Root>
  );
};

export const EditObjectIdDialog = defineDialog('EditObjectIdDialog', EditObjectIdDialogContent, {
  width: 480,
  height: 300,
  minWidth: 320,
  minHeight: 200,
});
