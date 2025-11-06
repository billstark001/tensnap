import React, { useRef, useEffect, useCallback } from 'react';
import * as styles from './styles.css';
import { useCallbackRef } from '@/utils/react';

interface ResizeHandlesProps {
  onResizeStart: (direction: string) => void;
  onResizeEnd: (deltaWidth: number, deltaHeight: number, direction: string) => void;
  onResize: (deltaWidth: number, deltaHeight: number, direction: string) => void;
}

const calculateDeltaWidthHeight = (isResizing: string, e: MouseEvent, lastX: number, lastY: number) => {
  const deltaX = e.clientX - lastX;
  const deltaY = e.clientY - lastY;

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

  return { deltaWidth, deltaHeight };
};

export const ResizeHandles: React.FC<ResizeHandlesProps> = ({
  onResizeStart,
  onResize: _onResize,
  onResizeEnd: _onResizeEnd,
}) => {
  const isResizing = useRef<string | undefined>(undefined);
  const startPos = useRef<{ x: number, y: number } | undefined>(undefined);
  const rafId = useRef<number | undefined>(undefined);
  const lastUpdateTime = useRef<number>(0);

  const onResize = useCallbackRef(_onResize);
  const onResizeEnd = useCallbackRef(_onResizeEnd);

  const handleMouseDown = (e: React.MouseEvent, direction: string) => {
    e.stopPropagation();
    e.preventDefault();
    isResizing.current = direction;
    startPos.current = { x: e.clientX, y: e.clientY };
    onResizeStart(direction);
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!startPos.current || !isResizing.current) {
      return;
    }

    // 使用 requestAnimationFrame 优化性能
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
    }

    rafId.current = requestAnimationFrame(() => {
      const currentTime = Date.now();
      // 限制更新频率，避免过于频繁的计算
      if (currentTime - lastUpdateTime.current < 16) return;

      lastUpdateTime.current = currentTime;

      if (!startPos.current || !isResizing.current) return;

      const { x: lastX, y: lastY } = startPos.current;
      const {
        deltaWidth, deltaHeight
      } = calculateDeltaWidthHeight(isResizing.current, e, lastX, lastY);

      onResize(deltaWidth, deltaHeight, isResizing.current);
    });
  }, [onResize]);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (!startPos.current || !isResizing.current) {
      return;
    }

    // 清理 requestAnimationFrame
    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = undefined;
    }

    const { x: lastX, y: lastY } = startPos.current;
    const {
      deltaWidth, deltaHeight
    } = calculateDeltaWidthHeight(isResizing.current, e, lastX, lastY);

    onResizeEnd(deltaWidth, deltaHeight, isResizing.current);

    isResizing.current = undefined;
    startPos.current = undefined;
  }, [onResizeEnd]);

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      // 清理 requestAnimationFrame
      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, [handleMouseMove, handleMouseUp]);

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