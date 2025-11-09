import React, { useCallback } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { DirectoryEntry } from 'tensnap-web/types/file';
import { formatFileSize, formatDate } from './utils';
import * as styles from './FileSystemBrowser.css';

export interface FileItemProps {
  entry: DirectoryEntry;
  isSelected: boolean;
  onItemClick: (entry: DirectoryEntry) => void;
  onDelete: (entry: DirectoryEntry) => void;
}

export const FileItem: React.FC<FileItemProps> = ({
  entry,
  isSelected,
  onItemClick,
  onDelete
}) => {
  
  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(entry);
  }, [entry, onDelete]);

  const handleItemClick = useCallback(() => {
    onItemClick(entry);
  }, [entry, onItemClick]);

  // 格式化详情信息
  const detailsText = entry.type === 'file' 
    ? `${formatFileSize(entry.size)} • ${formatDate(entry.modifiedAt)}`
    : `目录 • ${formatDate(entry.modifiedAt)}`;

  return (
    <div
      className={isSelected ? styles.listItemSelected : styles.listItem}
      onClick={handleItemClick}
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
              aria-label="操作菜单"
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
                删除
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
};
