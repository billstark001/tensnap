import React, { useMemo } from 'react';
import { t } from '@lingui/core/macro';
import { parseBreadcrumbs } from './utils';
import * as styles from './FileSystemBrowser.css';

export interface BreadcrumbsProps {
  currentDirectory: string;
  onNavigate: (path: string) => void;
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({
  currentDirectory,
  onNavigate
}) => {
  const breadcrumbs = useMemo(() => parseBreadcrumbs(currentDirectory), [currentDirectory]);

  return (
    <div className={styles.breadcrumbs}>
      {breadcrumbs.map((crumb, index) => (
        <React.Fragment key={crumb.path}>
          {index > 0 && <span className={styles.breadcrumbSeparator}>/</span>}
          <span 
            className={index === breadcrumbs.length - 1 ? styles.breadcrumbCurrent : styles.breadcrumbItem}
            onClick={() => onNavigate(crumb.path)}
          >
            {crumb.path === '/' ? t`Root` : crumb.name}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
};
