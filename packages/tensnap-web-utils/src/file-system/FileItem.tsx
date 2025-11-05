import React, { useCallback } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { DirectoryEntry, DirectoryMetadata, FileMetadata } from 'tensnap-web/types/file';
import * as styles from './FileSystemBrowser.css';

export interface FileItemProps {
  entry: DirectoryEntry;
  metadata?: FileMetadata | DirectoryMetadata;
  isSelected: boolean;
  onItemClick: (entry: DirectoryEntry) => void;
  onDelete: (entry: DirectoryEntry) => void;
  formatFileSize: (bytes: number) => string;
  formatDate: (date: Date) => string;
}

export const FileItem: React.FC<FileItemProps> = ({
  entry,
  isSelected,
  onItemClick,
  onDelete,
  formatFileSize,
  formatDate
}) => {
  
  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(entry);
  }, [entry, onDelete]);

  const handleItemClick = useCallback(() => {
    onItemClick(entry);
  }, [entry, onItemClick]);

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
          {entry.type === 'file' 
            ? `${formatFileSize(entry.size)} • ${formatDate(entry.modifiedAt)}`
            : `目录 • ${formatDate(entry.modifiedAt)}`
          }
        </div>
      </div>
      <div className={styles.itemActions}>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button 
              className={styles.itemActionButton}
              onClick={(e) => e.stopPropagation()}
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
