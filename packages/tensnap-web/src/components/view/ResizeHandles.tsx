import React, { useState, useRef, useEffect } from 'react';
import * as styles from './styles.css';

interface ResizeHandlesProps {
  onResize: (deltaWidth: number, deltaHeight: number, direction: string) => void;
}

export const ResizeHandles: React.FC<ResizeHandlesProps> = ({ onResize }) => {
  const [isResizing, setIsResizing] = useState<string | null>(null);
  const startPos = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent, direction: string) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(direction);
    startPos.current = { x: e.clientX, y: e.clientY };
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startPos.current.x;
      const deltaY = e.clientY - startPos.current.y;
      
      let deltaWidth = 0;
      let deltaHeight = 0;

      switch (isResizing) {
        case 'se':
          deltaWidth = deltaX;
          deltaHeight = deltaY;
          break;
        case 'e':
          deltaWidth = deltaX;
          break;
        case 's':
          deltaHeight = deltaY;
          break;
      }

      onResize(deltaWidth, deltaHeight, isResizing);
      startPos.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseUp = () => {
      setIsResizing(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, onResize]);

  return (
    <>
      <div
        className={styles.resizeHandle.se}
        onMouseDown={(e) => handleMouseDown(e, 'se')}
      />
      <div
        className={styles.resizeHandle.e}
        onMouseDown={(e) => handleMouseDown(e, 'e')}
      />
      <div
        className={styles.resizeHandle.s}
        onMouseDown={(e) => handleMouseDown(e, 's')}
      />
    </>
  );
};