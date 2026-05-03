import React, { useRef, useCallback } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { t } from '@lingui/macro';
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
        {t`Refresh`}
      </button>
      <button 
        className={styles.actionButton}
        onClick={onCreate}
      >
        {t`New`}
      </button>
      {allowUpload && (
        <button 
          className={styles.primaryButton}
          onClick={handleUploadClick}
          disabled={loading}
        >
          {t`Upload Files`}
        </button>
      )}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className={styles.actionButton}>{t`More Actions`}</button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className={styles.dropdownContent}>
            <DropdownMenu.Item 
              className={styles.dropdownItem}
              onClick={() => onExport()}
            >
              {t`Export`}
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
