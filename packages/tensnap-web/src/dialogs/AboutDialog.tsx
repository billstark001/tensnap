import React from 'react';
import * as Dialog from '@tensnap/web-common/components/ui/Dialog';
import * as dialogStyles from './AboutDialog.css';
import { DialogOpenProps } from '@tensnap/web-common/react';
import { Trans } from '@lingui/react/macro';

export const AboutDialog: React.FC<DialogOpenProps> = ({
  open,
  onOpenChange,
}) => {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Title>
        <Trans>About TenSnap</Trans>
      </Dialog.Title>
      <Dialog.Description></Dialog.Description>

      <div className={dialogStyles.aboutContainer}>
        <div className={dialogStyles.aboutHeader}>
          <img src="/logo192.png" alt="TenSnap Logo" className={dialogStyles.aboutLogo} />
          <h2 className={dialogStyles.aboutTitle}>
            TenSnap
          </h2>
          <p className={dialogStyles.aboutVersion}>
            <Trans>Version</Trans> {__APP_VERSION__}
          </p>
        </div>

        <div className={dialogStyles.aboutDescription}>
          <p className={dialogStyles.aboutText}>
            <Trans>
              TenSnap is an interactive simulation toolset for agent-based models,
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

      <Dialog.Footer>
        <Dialog.Close asChild>
          <Dialog.Button>
            <Trans>Close</Trans>
          </Dialog.Button>
        </Dialog.Close>
      </Dialog.Footer>
    </Dialog.Root>
  );
};
