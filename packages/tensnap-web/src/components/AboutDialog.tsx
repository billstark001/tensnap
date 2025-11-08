import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as dialogStyles from '@/styles/dialog.css';
import { DialogOpenProps } from '@/utils/react';
import { Trans } from '@lingui/react/macro';

export interface AboutDialogProps extends DialogOpenProps {

}

export const AboutDialog: React.FC<AboutDialogProps> = ({
  open,
  onOpenChange,
}) => {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogStyles.dialogOverlay} />
        <Dialog.Content className={dialogStyles.dialogContent}>
          <Dialog.Title className={dialogStyles.dialogTitle}>
            <Trans>About TenSnap</Trans>
          </Dialog.Title>
          <Dialog.Description></Dialog.Description>

          <div className={dialogStyles.aboutContainer}>
            <div className={dialogStyles.aboutHeader}>
              <h2 className={dialogStyles.aboutTitle}>
                TenSnap
              </h2>
              <p className={dialogStyles.aboutVersion}>
                <Trans>Version</Trans> 0.1.0
              </p>
            </div>

            <div className={dialogStyles.aboutDescription}>
              <p className={dialogStyles.aboutText}>
                <Trans>
                  TenSnap is a visualization and simulation tool for tensor network models,
                  designed to help researchers and students understand complex systems through
                  interactive simulations and visualizations.
                </Trans>
              </p>
            </div>

            <div className={dialogStyles.aboutLinks}>
              <div className={dialogStyles.aboutLinkItem}>
                <strong><Trans>Repository:</Trans></strong>{' '}
                <a
                  href="https://github.com/billstark001/tensnap"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={dialogStyles.aboutLink}
                >
                  github.com/billstark001/tensnap
                </a>
              </div>

              <div className={dialogStyles.aboutLinkItem}>
                <strong><Trans>Documentation:</Trans></strong>{' '}
                <a
                  href="https://github.com/billstark001/tensnap/tree/main/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                  className={dialogStyles.aboutLink}
                >
                  <Trans>View Docs</Trans>
                </a>
              </div>

              <div className={dialogStyles.aboutLinkItem}>
                <strong><Trans>License:</Trans></strong> MIT
              </div>
            </div>

            <div className={dialogStyles.aboutFooter}>
              <Trans>© 2025 TenSnap Contributors</Trans>
            </div>
          </div>

          <div className={dialogStyles.dialogFooter}>
            <Dialog.Close asChild>
              <button className={dialogStyles.dialogButton}><Trans>Close</Trans></button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};
