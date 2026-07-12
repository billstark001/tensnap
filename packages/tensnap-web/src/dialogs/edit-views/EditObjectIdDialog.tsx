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
  title: React.ReactNode;
  currentId: string;
  objectExists: boolean;
  validateId: (nextId: string) => string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (nextId: string) => void;
}

export const EditObjectIdDialog: React.FC<EditObjectIdDialogProps> = ({
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

  const handleSubmit = () => {
    const validationError = validateId(draftId);
    if (validationError) {
      toast.warning(_(msg`Invalid ID`), validationError);
      // return;
    }
    onSubmit(draftId);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} size="md" closeOnInteractOutside={false}>
      <Dialog.CloseButton />
      <Dialog.Title>{title}</Dialog.Title>
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
              <Trans>No object is registered for the current ID; the view binding will be updated.</Trans>
            )}
          </div>
        </Form.Field>
      </Dialog.Body>

      <Dialog.Footer>
        <Dialog.Button variant="primary" onClick={handleSubmit}>
          <Trans>Apply</Trans>
        </Dialog.Button>
        <Dialog.Close asChild>
          <Dialog.Button><Trans>Cancel</Trans></Dialog.Button>
        </Dialog.Close>
      </Dialog.Footer>
    </Dialog.Root>
  );
};
