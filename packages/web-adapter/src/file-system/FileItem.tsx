import React, { useCallback } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { t } from '@lingui/macro';
import { DirectoryEntry } from '@tensnap/web/types/file';
import { formatFileSize, formatDate } from './utils';
import * as styles from './FileSystemBrowser.css';

export interface FileItemProps {
  entry: DirectoryEntry;
  isSelected: boolean;
  onItemClick: (entry: DirectoryEntry) => void;
  onItemDoubleClick?: (entry: DirectoryEntry) => void;
  onDelete: (entry: DirectoryEntry) => void;
}

export const FileItem: React.FC<FileItemProps> = ({
  entry,
  isSelected,
  onItemClick,
  onItemDoubleClick,
  onDelete
}) => {
  
  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(entry);
  }, [entry, onDelete]);

  const handleItemClick = useCallback(() => {
    onItemClick(entry);
  }, [entry, onItemClick]);

  const handleItemDoubleClick = useCallback(() => {
    if (onItemDoubleClick) {
      onItemDoubleClick(entry);
    }
  }, [entry, onItemDoubleClick]);

  // 格式化详情信息
  const detailsText = entry.type === 'file' 
    ? `${formatFileSize(entry.size)} • ${formatDate(entry.modifiedAt)}`
    : `${t`Directory`} • ${formatDate(entry.modifiedAt)}`;

  return (
    <div
      className={isSelected ? styles.listItemSelected : styles.listItem}
      onClick={handleItemClick}
      onDoubleClick={handleItemDoubleClick}
    >
      <div className={styles.itemIcon}>
        {entry.type === 'directory' ? '📁' : '📄'}
      </div>
      <div className={styles.itemContent}>
        <div className={styles.itemName}>{entry.name}</div>
        <div className={styles.itemDetails}>
          {detailsText}
        </div>
      </div>
      <div className={styles.itemActions}>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button 
              className={styles.itemActionButton}
              onClick={(e) => e.stopPropagation()}
              aria-label={t`Action menu`}
            >
              ⋮
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className={styles.dropdownContentSmall}>
              <DropdownMenu.Item 
                className={styles.dropdownItemDanger}
                onClick={handleDeleteClick}
              >
                {t`Delete`}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
};
