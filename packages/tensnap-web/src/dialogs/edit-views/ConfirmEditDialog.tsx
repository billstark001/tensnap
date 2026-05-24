import React from 'react';
import { Trans } from '@lingui/react/macro';
import * as Dialog from '@tensnap/web-common/components/ui/Dialog';

interface ConfirmEditDialogProps {
  open: boolean;
  title: React.ReactNode;
  description: React.ReactNode;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export const ConfirmEditDialog: React.FC<ConfirmEditDialogProps> = ({
  open,
  title,
  description,
  onOpenChange,
  onConfirm,
}) => (
  <Dialog.Root open={open} onOpenChange={onOpenChange} size="md" closeOnInteractOutside={false}>
    <Dialog.CloseButton />
    <Dialog.Title>{title}</Dialog.Title>
    <Dialog.Description>{description}</Dialog.Description>
    <Dialog.Footer>
      <Dialog.Button
        variant="primary"
        onClick={() => {
          onConfirm();
          onOpenChange(false);
        }}
      >
        <Trans>Confirm</Trans>
      </Dialog.Button>
      <Dialog.Close asChild>
        <Dialog.Button><Trans>Cancel</Trans></Dialog.Button>
      </Dialog.Close>
    </Dialog.Footer>
  </Dialog.Root>
);
