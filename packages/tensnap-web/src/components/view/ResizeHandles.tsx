import React from 'react';
import * as styles from './styles.css';

interface ResizeHandlesProps {
  horizontalOnly?: boolean;
  onResizeStart: (direction: string, e: React.MouseEvent) => void;
}

export const ResizeHandles: React.FC<ResizeHandlesProps> = ({
  horizontalOnly = false,
  onResizeStart,
}) => {
  const handleMouseDown = (e: React.MouseEvent, direction: string) => {
    e.stopPropagation();
    e.preventDefault();
    onResizeStart(direction, e);
  };

  return (
    <>
      {!horizontalOnly && <div
        className={styles.resizeHandle.se}
        onMouseDown={(e) => handleMouseDown(e, 'se')}
      />}
      <div
        className={styles.resizeHandle.e}
        onMouseDown={(e) => handleMouseDown(e, 'e')}
      />
      {!horizontalOnly && <div
        className={styles.resizeHandle.s}
        onMouseDown={(e) => handleMouseDown(e, 's')}
      />}
    </>
  );
};