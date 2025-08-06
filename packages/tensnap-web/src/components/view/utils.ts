import { AlignmentGuides, AnyView, ContainerView } from "@/types/ui";
import { GRID_SIZE, SNAP_THRESHOLD } from "./constants";
import { useCallback, useRef } from 'react';

export function generateUniqueId() {
  const timestamp = Date.now().toString(36).slice(-6);
  const randomPart = Math.random().toString(36).slice(2, 12); // Shorter random part
  return `${randomPart}${timestamp}`;
}

export const snapToGrid = (value: number, gridSize: number = GRID_SIZE): number => {
  return Math.round(value / gridSize) * gridSize;
};

export const findAlignmentPoints = (views: AnyView[], excludeId?: string): AlignmentGuides => {
  const guides: AlignmentGuides = {
    vertical: [],
    horizontal: [],
  };

  views.forEach((view) => {
    if (view.id === excludeId) return;

    // Vertical alignment points (x-axis)
    guides.vertical.push(view.left); // Left edge
    guides.vertical.push(view.left + view.width / 2); // Center
    guides.vertical.push(view.left + view.width); // Right edge

    // Horizontal alignment points (y-axis)
    guides.horizontal.push(view.top); // Top edge
    guides.horizontal.push(view.top + view.height / 2); // Center
    guides.horizontal.push(view.top + view.height); // Bottom edge

    // Recursively check container children
    if (view.type === 'container') {
      const containerView = view as ContainerView;
      const childGuides = findAlignmentPoints(containerView.views, excludeId);
      guides.vertical.push(...childGuides.vertical.map(x => x + view.left));
      guides.horizontal.push(...childGuides.horizontal.map(y => y + view.top));
    }
  });

  // Remove duplicates and sort
  guides.vertical = [...new Set(guides.vertical)].sort((a, b) => a - b);
  guides.horizontal = [...new Set(guides.horizontal)].sort((a, b) => a - b);

  return guides;
};

export const findSnapPosition = (
  position: { x: number; y: number; width: number; height: number },
  guides: AlignmentGuides,
  threshold: number = SNAP_THRESHOLD
): { x: number; y: number; snappedGuides: { vertical?: number; horizontal?: number } } => {
  let snappedX = position.x;
  let snappedY = position.y;
  const snappedGuides: { vertical?: number; horizontal?: number } = {};

  // Check for vertical snapping (x-axis)
  const xPoints = [
    position.x, // Left edge
    position.x + position.width / 2, // Center
    position.x + position.width, // Right edge
  ];

  for (const point of xPoints) {
    for (const guide of guides.vertical) {
      if (Math.abs(point - guide) < threshold) {
        snappedX = guide - (point - position.x);
        snappedGuides.vertical = guide;
        break;
      }
    }
    if (snappedGuides.vertical) break;
  }

  // Check for horizontal snapping (y-axis)
  const yPoints = [
    position.y, // Top edge
    position.y + position.height / 2, // Center
    position.y + position.height, // Bottom edge
  ];

  for (const point of yPoints) {
    for (const guide of guides.horizontal) {
      if (Math.abs(point - guide) < threshold) {
        snappedY = guide - (point - position.y);
        snappedGuides.horizontal = guide;
        break;
      }
    }
    if (snappedGuides.horizontal) break;
  }

  // Also snap to grid if no guide snapping occurred
  if (!snappedGuides.vertical) {
    snappedX = snapToGrid(position.x);
  }
  if (!snappedGuides.horizontal) {
    snappedY = snapToGrid(position.y);
  }

  return { x: snappedX, y: snappedY, snappedGuides };
};



/**
 * A custom hook that returns a memoized callback ref function.
 * This is useful when you need a stable callback function that doesn't change
 * between renders, but you want to access the latest value of dependencies.
 * 
 * @param callback - The callback function to memoize
 * @param deps - Dependencies array for the callback
 * @returns A memoized callback function
 */
function useCallbackRef<T extends (...args: any[]) => any>(
  callback: T | undefined,
  deps: React.DependencyList = []
): T {
  const callbackRef = useRef(callback);
  
  // Update the ref with the latest callback
  callbackRef.current = callback;
  
  // Return a memoized function that calls the latest callback
  return useCallback(
    ((...args) => callbackRef.current?.(...args)) as T,
    deps
  );
}

export { useCallbackRef };