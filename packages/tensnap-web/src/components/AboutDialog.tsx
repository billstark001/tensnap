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

          <div style={{ padding: '20px 0' }}>
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '8px' }}>
                TenSnap
              </h2>
              <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                <Trans>Version</Trans> 0.1.0
              </p>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <p style={{ fontSize: '14px', lineHeight: '1.6', marginBottom: '12px' }}>
                <Trans>
                  TenSnap is a visualization and simulation tool for tensor network models,
                  designed to help researchers and students understand complex systems through
                  interactive simulations and visualizations.
                </Trans>
              </p>
            </div>

            <div style={{ marginTop: '20px', borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
              <div style={{ marginBottom: '12px' }}>
                <strong><Trans>Repository:</Trans></strong>{' '}
                <a
                  href="https://github.com/billstark001/tensnap"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--link-color)', textDecoration: 'none' }}
                >
                  github.com/billstark001/tensnap
                </a>
              </div>

              <div style={{ marginBottom: '12px' }}>
                <strong><Trans>Documentation:</Trans></strong>{' '}
                <a
                  href="https://github.com/billstark001/tensnap/tree/main/docs"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--link-color)', textDecoration: 'none' }}
                >
                  <Trans>View Docs</Trans>
                </a>
              </div>

              <div>
                <strong><Trans>License:</Trans></strong> MIT
              </div>
            </div>

            <div style={{ marginTop: '20px', fontSize: '12px', color: 'var(--text-secondary)', textAlign: 'center' }}>
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
