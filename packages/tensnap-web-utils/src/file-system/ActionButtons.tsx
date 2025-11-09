import React, { useRef, useCallback } from 'react';
import { Trans } from '@lingui/react/macro';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as styles from './FileSystemBrowser.css';

export interface ActionButtonsProps {
  loading: boolean;
  allowUpload: boolean;
  onRefresh: () => void;
  onCreate: () => void;
  onExport: () => void;
  onFileInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

export const ActionButtons: React.FC<ActionButtonsProps> = ({
  loading,
  allowUpload,
  onRefresh,
  onCreate,
  onExport,
  onFileInputChange
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <div className={styles.actionButtons}>
      <button 
        className={styles.actionButton}
        onClick={onRefresh}
        disabled={loading}
      >
        <Trans>Refresh</Trans>
      </button>
      <button 
        className={styles.actionButton}
        onClick={onCreate}
      >
        <Trans>New</Trans>
      </button>
      {allowUpload && (
        <button 
          className={styles.primaryButton}
          onClick={handleUploadClick}
          disabled={loading}
        >
          <Trans>Upload Files</Trans>
        </button>
      )}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className={styles.actionButton}><Trans>More Actions</Trans></button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className={styles.dropdownContent}>
            <DropdownMenu.Item 
              className={styles.dropdownItem}
              onClick={() => onExport()}
            >
              <Trans>Export</Trans>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className={styles.hiddenFileInput}
        onChange={onFileInputChange}
      />
    </div>
  );
};
