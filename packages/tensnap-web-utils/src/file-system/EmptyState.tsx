import React from 'react';
import * as styles from './FileSystemBrowser.css';
import { Trans } from '@lingui/react/macro';

export interface EmptyStateProps {
  allowUpload: boolean;
  isDragOver: boolean;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  allowUpload,
  isDragOver
}) => {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyStateIcon}>📂</div>
      <div className={styles.emptyStateText}><Trans>This directory is empty</Trans></div>
      {allowUpload && (
        <div className={isDragOver ? styles.uploadAreaActive : styles.uploadArea}>
          <div className={styles.uploadText}><Trans>Drag files here to upload</Trans></div>
          <div className={styles.uploadHint}><Trans>Or use the "Upload Files" button above</Trans></div>
        </div>
      )}
    </div>
  );
};
