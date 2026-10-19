import { defineDialog } from '@tensnap/web-common/workbench/dialog-content';
import React, { useState } from 'react';
import { Trans } from '@lingui/react/macro';
import * as Dialog from '@tensnap/web-common/components/ui/Dialog';

interface ConfirmEditDialogProps {
  open: boolean;
  title: React.ReactNode;
  description: React.ReactNode;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
}

const ConfirmEditDialogContent: React.FC<ConfirmEditDialogProps> = ({
  open,
  title,
  description,
  onOpenChange,
  onConfirm,
}) => {
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} size="md" closeOnInteractOutside={false}>
      <Dialog.CloseButton />
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>{description}</Dialog.Description>
      {error && <p role="alert">{error}</p>}
      <Dialog.Footer>
        <Dialog.Button
          variant="primary"
          onClick={async () => {
            try {
              await onConfirm();
              onOpenChange(false);
            } catch (error) {
              setError(String(error));
            }
          }}
        >
          <Trans>Confirm</Trans>
        </Dialog.Button>
        <Dialog.Close asChild>
          <Dialog.Button>
            <Trans>Cancel</Trans>
          </Dialog.Button>
        </Dialog.Close>
      </Dialog.Footer>
    </Dialog.Root>
  );
};

export const ConfirmEditDialog = defineDialog('ConfirmEditDialog', ConfirmEditDialogContent);
