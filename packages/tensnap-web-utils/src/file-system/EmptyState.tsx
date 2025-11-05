import React from 'react';
import * as styles from './FileSystemBrowser.css';

export interface EmptyStateProps {
  allowUpload: boolean;
  isDragOver: boolean;
  onUploadClick: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  allowUpload,
  isDragOver,
  onUploadClick
}) => {
  return (
    <div className={styles.emptyState}>
      <div>此目录为空</div>
      {allowUpload && (
        <div 
          className={isDragOver ? styles.uploadAreaActive : styles.uploadArea}
          onClick={onUploadClick}
        >
          <div className={styles.uploadText}>拖拽文件到此处或点击上传</div>
          <div className={styles.uploadHint}>支持多文件上传</div>
        </div>
      )}
    </div>
  );
};
