import React from 'react';
import * as styles from './FileSystemBrowser.css';

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
      <div className={styles.emptyStateText}>此目录为空</div>
      {allowUpload && (
        <div className={isDragOver ? styles.uploadAreaActive : styles.uploadArea}>
          <div className={styles.uploadText}>拖拽文件到此处上传</div>
          <div className={styles.uploadHint}>或使用上方的"上传文件"按钮</div>
        </div>
      )}
    </div>
  );
};
