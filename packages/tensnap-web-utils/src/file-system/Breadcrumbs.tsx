import React, { useCallback } from 'react';
import * as styles from './FileSystemBrowser.css';

export interface BreadcrumbsProps {
  currentDirectory: string;
  onNavigate: (path: string) => void;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
  currentDirectory,
  onNavigate
}) => {
  const breadcrumbParts = currentDirectory.split('/').filter(Boolean);
  
  const handleBreadcrumbClick = useCallback((index: number) => {
    const newPath = index === -1 ? '/' : '/' + breadcrumbParts.slice(0, index + 1).join('/');
    onNavigate(newPath);
  }, [breadcrumbParts, onNavigate]);

  return (
    <div className={styles.breadcrumbs}>
      <span 
        className={currentDirectory === '/' ? styles.breadcrumbCurrent : styles.breadcrumbItem}
        onClick={() => handleBreadcrumbClick(-1)}
      >
        根目录
      </span>
      {breadcrumbParts.map((part, index) => (
        <React.Fragment key={index}>
          <span className={styles.breadcrumbSeparator}>/</span>
          <span 
            className={index === breadcrumbParts.length - 1 ? styles.breadcrumbCurrent : styles.breadcrumbItem}
            onClick={() => handleBreadcrumbClick(index)}
          >
            {part}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
};
