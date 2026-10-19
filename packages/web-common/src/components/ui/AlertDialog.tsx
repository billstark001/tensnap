import { defineDialog } from '../../workbench/dialog-content';
import type { ReactNode } from 'react';
import * as Dialog from './Dialog';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  confirmLabel?: ReactNode;
  cancelLabel?: ReactNode;
  confirmVariant?: 'primary' | 'danger' | 'normal';
  onConfirm: () => void;
}
function ConfirmDialogContent({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'primary',
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} closeOnInteractOutside={false}>
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>{description}</Dialog.Description>
      <Dialog.Footer>
        <Dialog.Button onClick={() => onOpenChange(false)}>{cancelLabel}</Dialog.Button>
        <Dialog.Button variant={confirmVariant} onClick={onConfirm}>
          {confirmLabel}
        </Dialog.Button>
      </Dialog.Footer>
    </Dialog.Root>
  );
}
export interface AlertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  acknowledgeLabel?: ReactNode;
  onAcknowledge?: () => void;
}
function AlertDialogContent({
  open,
  onOpenChange,
  title,
  description,
  acknowledgeLabel = 'OK',
  onAcknowledge,
}: AlertDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} closeOnInteractOutside={false}>
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Description>{description}</Dialog.Description>
      <Dialog.Footer>
        <Dialog.Button
          variant="primary"
          onClick={() => {
            onAcknowledge?.();
            onOpenChange(false);
          }}
        >
          {acknowledgeLabel}
        </Dialog.Button>
      </Dialog.Footer>
    </Dialog.Root>
  );
}

export const ConfirmDialog = defineDialog('ConfirmDialog', ConfirmDialogContent);

export const AlertDialog = defineDialog('AlertDialog', AlertDialogContent);
