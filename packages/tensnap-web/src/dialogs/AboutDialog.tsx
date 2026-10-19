import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { defineDialog } from '@tensnap/web-common/workbench/dialog-content';
import React from 'react';
import * as Dialog from '@tensnap/web-common/components/ui/Dialog';
import * as dialogStyles from './AboutDialog.css';
import { DialogOpenProps } from '@tensnap/web-common/react';
import { Trans } from '@lingui/react/macro';

const AboutDialogContent: React.FC<DialogOpenProps> = ({ open, onOpenChange }) => {
  const { _ } = useLingui();

  return (
    <Dialog.Root title={_(msg`About TenSnap`)} open={open} onOpenChange={onOpenChange}>
      <Dialog.Description></Dialog.Description>

      <div className={dialogStyles.aboutContainer}>
        <div className={dialogStyles.aboutHeader}>
          <img src="/logo192.png" alt="TenSnap Logo" className={dialogStyles.aboutLogo} />
          <h2 className={dialogStyles.aboutTitle}>TenSnap</h2>
          <p className={dialogStyles.aboutVersion}>
            <Trans>Version</Trans> {__APP_VERSION__}
          </p>
        </div>

        <div className={dialogStyles.aboutDescription}>
          <p className={dialogStyles.aboutText}>
            <Trans>
              TenSnap is an interactive simulation toolset for agent-based models, designed to help
              researchers and students understand complex systems through interactive simulations
              and visualizations.
            </Trans>
          </p>
        </div>

        <div className={dialogStyles.aboutLinks}>
          <div className={dialogStyles.aboutLinkItem}>
            <strong>
              <Trans>Repository:</Trans>
            </strong>{' '}
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
            <strong>
              <Trans>Documentation:</Trans>
            </strong>{' '}
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
            <strong>
              <Trans>License:</Trans>
            </strong>{' '}
            MIT
          </div>
        </div>

        <div className={dialogStyles.aboutFooter}>
          <Trans>© 2025 TenSnap Contributors</Trans>
        </div>
      </div>
    </Dialog.Root>
  );
};

export const AboutDialog = defineDialog('AboutDialog', AboutDialogContent, {
  width: 480,
  height: 460,
  minWidth: 320,
  minHeight: 240,
});
