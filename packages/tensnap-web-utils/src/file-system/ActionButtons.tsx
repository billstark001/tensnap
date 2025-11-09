import React, { useRef, useCallback } from 'react';
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
        刷新
      </button>
      <button 
        className={styles.actionButton}
        onClick={onCreate}
      >
        新建
      </button>
      {allowUpload && (
        <button 
          className={styles.primaryButton}
          onClick={handleUploadClick}
          disabled={loading}
        >
          上传文件
        </button>
      )}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className={styles.actionButton}>更多操作</button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className={styles.dropdownContent}>
            <DropdownMenu.Item 
              className={styles.dropdownItem}
              onClick={() => onExport()}
            >
              导出
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
