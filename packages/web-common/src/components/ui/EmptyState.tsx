import React from 'react';
import * as styles from './EmptyState.css';
import { Trans } from '@lingui/react/macro';
import clsx from 'clsx';

export interface EmptyStateAction {
  label: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}

export interface EmptyStateUploadProps {
  isDragOver?: boolean;
  uploadText?: React.ReactNode;
  uploadHint?: React.ReactNode;
  onUploadClick?: () => void;
}

export interface EmptyStateProps {
  /**
   * Icon to display (emoji or string)
   */
  icon?: React.ReactNode;
  
  /**
   * Title of the empty state
   */
  title?: React.ReactNode;
  
  /**
   * Description text
   */
  description?: React.ReactNode;
  
  /**
   * Action buttons to display
   */
  actions?: EmptyStateAction[];
  
  /**
   * Upload area configuration
   */
  upload?: EmptyStateUploadProps;
  
  /**
   * Use compact layout
   */
  compact?: boolean;
  
  /**
   * Custom className for additional styling
   */
  className?: string;
  
  /**
   * Custom children to render instead of default content
   */
  children?: React.ReactNode;
}

/**
 * EmptyState component - displays a message when there's no content
 * 
 * Features:
 * - Customizable icon, title, and description
 * - Action buttons support (primary and secondary)
 * - Optional upload area with drag-and-drop indication
 * - Compact mode for smaller spaces
 * - Fully internationalized with lingui
 * - Dark mode support
 * 
 * @example
 * ```tsx
 * // Simple empty state
 * <EmptyState 
 *   icon="📂"
 *   title={<Trans>No files found</Trans>}
 *   description={<Trans>Start by creating a new file</Trans>}
 * />
 * 
 * // With actions
 * <EmptyState 
 *   icon="🔍"
 *   title={<Trans>No results</Trans>}
 *   actions={[
 *     { label: <Trans>Clear search</Trans>, onClick: handleClear },
 *     { label: <Trans>Reset filters</Trans>, onClick: handleReset, primary: true }
 *   ]}
 * />
 * 
 * // With upload area
 * <EmptyState 
 *   icon="📂"
 *   title={<Trans>Directory is empty</Trans>}
 *   upload={{
 *     isDragOver: isDragOver,
 *     uploadText: <Trans>Drag files here</Trans>,
 *     uploadHint: <Trans>Or click to browse</Trans>,
 *     onUploadClick: handleUpload
 *   }}
 * />
 * ```
 */
export function EmptyState({
  icon = '📭',
  title,
  description,
  actions,
  upload,
  compact = false,
  className,
  children,
}: EmptyStateProps) {
  const containerClass = compact ? styles.emptyStateCompact : styles.emptyState;
  
  if (children) {
    return (
      <div className={clsx(containerClass, className)}>
        {children}
      </div>
    );
  }
  
  return (
    <div className={clsx(containerClass, className)}>
      {icon && <div className={styles.emptyStateIcon}>{icon}</div>}
      
      {title && <div className={styles.emptyStateTitle}>{title}</div>}
      
      {description && (
        <div className={styles.emptyStateDescription}>{description}</div>
      )}
      
      {actions && actions.length > 0 && (
        <div className={styles.emptyStateActions}>
          {actions.map((action, index) => (
            <button
              key={index}
              onClick={action.onClick}
              className={
                action.primary
                  ? styles.emptyStatePrimaryButton
                  : styles.emptyStateButton
              }
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
      
      {upload && (
        <div
          className={
            upload.isDragOver ? styles.uploadAreaActive : styles.uploadArea
          }
          onClick={upload.onUploadClick}
        >
          <div className={styles.uploadText}>
            {upload.uploadText || <Trans>Drag files here to upload</Trans>}
          </div>
          <div className={styles.uploadHint}>
            {upload.uploadHint || <Trans>Or click to browse</Trans>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Preset empty states for common use cases
 */
export const EmptyStatePresets = {
  /**
   * Empty directory/folder state
   */
  EmptyDirectory: (props: Partial<EmptyStateProps> = {}) => (
    <EmptyState
      icon="📂"
      title={<Trans>This directory is empty</Trans>}
      {...props}
    />
  ),
  
  /**
   * No search results state
   */
  NoSearchResults: ({ onClearSearch, ...props }: Partial<EmptyStateProps> & { onClearSearch?: () => void } = {}) => (
    <EmptyState
      icon="🔍"
      title={<Trans>No results found</Trans>}
      description={<Trans>Try adjusting your search criteria</Trans>}
      actions={
        onClearSearch
          ? [{ label: <Trans>Clear search</Trans>, onClick: onClearSearch }]
          : undefined
      }
      {...props}
    />
  ),
  
  /**
   * No agents/items state
   */
  NoItems: ({ itemName = 'items', ...props }: Partial<EmptyStateProps> & { itemName?: string } = {}) => (
    <EmptyState
      icon="📭"
      title={<Trans>No {itemName} available</Trans>}
      {...props}
    />
  ),
  
  /**
   * Empty with upload area
   */
  EmptyWithUpload: (uploadProps: EmptyStateUploadProps, props: Partial<EmptyStateProps> = {}) => (
    <EmptyState
      icon="📂"
      title={<Trans>This directory is empty</Trans>}
      upload={uploadProps}
      {...props}
    />
  ),
} as const;
