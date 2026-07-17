import * as RadixAlertDialog from '@radix-ui/react-alert-dialog';
import clsx from 'clsx';
import type { ReactNode } from 'react';
import * as dialogStyles from './Dialog.css';

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

/**
 * A deliberate, accessible replacement for blocking browser confirmation.
 * It never dismisses through the overlay or Escape: callers must handle an
 * explicit cancel/confirm decision.
 */
export function ConfirmDialog({
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
    <RadixAlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixAlertDialog.Portal>
        <RadixAlertDialog.Overlay className={dialogStyles.dialogOverlay} />
        <RadixAlertDialog.Content className={clsx(dialogStyles.dialogContent)}>
          <RadixAlertDialog.Title className={dialogStyles.dialogTitle}>{title}</RadixAlertDialog.Title>
          <RadixAlertDialog.Description className={dialogStyles.dialogDescription}>
            {description}
          </RadixAlertDialog.Description>
          <div className={dialogStyles.dialogFooter}>
            <RadixAlertDialog.Cancel asChild>
              <button type="button" className={dialogStyles.dialogButton}>{cancelLabel}</button>
            </RadixAlertDialog.Cancel>
            <RadixAlertDialog.Action asChild>
              <button
                type="button"
                className={clsx(
                  dialogStyles.dialogButton,
                  confirmVariant === 'primary' && dialogStyles.dialogButtonPrimary,
                  confirmVariant === 'danger' && dialogStyles.dialogButtonDanger,
                )}
                onClick={onConfirm}
              >
                {confirmLabel}
              </button>
            </RadixAlertDialog.Action>
          </div>
        </RadixAlertDialog.Content>
      </RadixAlertDialog.Portal>
    </RadixAlertDialog.Root>
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

/** Acknowledge-only counterpart to ConfirmDialog for non-recoverable notices. */
export function AlertDialog({
  open,
  onOpenChange,
  title,
  description,
  acknowledgeLabel = 'OK',
  onAcknowledge,
}: AlertDialogProps) {
  return (
    <RadixAlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixAlertDialog.Portal>
        <RadixAlertDialog.Overlay className={dialogStyles.dialogOverlay} />
        <RadixAlertDialog.Content className={dialogStyles.dialogContent}>
          <RadixAlertDialog.Title className={dialogStyles.dialogTitle}>{title}</RadixAlertDialog.Title>
          <RadixAlertDialog.Description className={dialogStyles.dialogDescription}>
            {description}
          </RadixAlertDialog.Description>
          <div className={dialogStyles.dialogFooter}>
            <RadixAlertDialog.Action asChild>
              <button
                type="button"
                className={clsx(dialogStyles.dialogButton, dialogStyles.dialogButtonPrimary)}
                onClick={onAcknowledge}
              >
                {acknowledgeLabel}
              </button>
            </RadixAlertDialog.Action>
          </div>
        </RadixAlertDialog.Content>
      </RadixAlertDialog.Portal>
    </RadixAlertDialog.Root>
  );
}
