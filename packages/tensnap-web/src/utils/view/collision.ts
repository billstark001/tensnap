import type { CollisionDetection, ClientRect, DroppableContainer, Collision } from '@dnd-kit/core';

const SCORE_TOLERANCE = 0.01;
const MIN_DEEPER_OVERLAP = 0.5;
const MIN_DEEPER_ZERO_DIMENSION_SCORE = 0.3;
const ZERO_DIMENSION_VALUE_SCALE = 1000;

/**
 * Calculate the overlap area between two rectangles
 * Handles cases where one or both rectangles have zero width/height
 */
function getOverlapArea(rect1: ClientRect, rect2: ClientRect): number {
  const left = Math.max(rect1.left, rect2.left);
  const right = Math.min(rect1.right, rect2.right);
  const top = Math.max(rect1.top, rect2.top);
  const bottom = Math.min(rect1.bottom, rect2.bottom);

  if (left >= right || top >= bottom) {
    return 0;
  }

  return (right - left) * (bottom - top);
}

/**
 * Calculate rectangle area, handling zero dimensions
 */
function getRectArea(rect: ClientRect): number {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  return Math.max(0, width * height);
}

/**
 * Check if a point is inside a rectangle
 */
function isPointInRect(x: number, y: number, rect: ClientRect): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * Check if a rectangle (even with zero dimensions) intersects with another rectangle
 */
function hasIntersection(rect1: ClientRect, rect2: ClientRect): boolean {
  // Standard rectangle intersection
  return !(
    rect1.right < rect2.left ||
    rect1.left > rect2.right ||
    rect1.bottom < rect2.top ||
    rect1.top > rect2.bottom
  );
}

/**
 * Calculate distance from center of dragged object to center of droppable container
 */
function getCenterDistance(rect1: ClientRect, rect2: ClientRect): number {
  const center1X = (rect1.left + rect1.right) / 2;
  const center1Y = (rect1.top + rect1.bottom) / 2;
  const center2X = (rect2.left + rect2.right) / 2;
  const center2Y = (rect2.top + rect2.bottom) / 2;

  return Math.hypot(center1X - center2X, center1Y - center2Y);
}

/**
 * Calculate collision score for zero-dimension objects
 * Uses distance-based scoring when overlap area cannot be calculated
 */
function getZeroDimensionScore(collisionRect: ClientRect, containerRect: ClientRect): number {
  const distance = getCenterDistance(collisionRect, containerRect);
  const containerArea = getRectArea(containerRect);

  // Use inverse distance normalized by container size as score
  // Smaller distance = higher score
  if (containerArea > 0) {
    const maxDimension = Math.max(
      containerRect.right - containerRect.left,
      containerRect.bottom - containerRect.top,
    );
    return Math.max(0, maxDimension - distance) / maxDimension;
  }

  return distance > 0 ? 1 / distance : 1;
}

/**
 * Check if one container is an ancestor of another
 */
function isAncestor(potentialAncestor: DroppableContainer, container: DroppableContainer): boolean {
  const ancestor = potentialAncestor.node.current;
  const node = container.node.current;
  return Boolean(ancestor && node && ancestor !== node && ancestor.contains(node));
}

/**
 * Calculate the nesting depth of a container
 */
function getContainerDepth(
  container: DroppableContainer,
  containerCounts: ReadonlyMap<Element, number>,
): number {
  let depth = 0;

  for (let node = container.node.current?.parentElement; node; node = node.parentElement) {
    depth += containerCounts.get(node) ?? 0;
  }

  return depth;
}

/**
 * Enhanced collision detection algorithm for nested overlapping areas
 * Handles cases where dragged object has zero width or height
 */
export const nestedOverlapCollisionDetection: CollisionDetection = ({
  active,
  collisionRect,
  droppableRects,
  droppableContainers,
}) => {
  const collisions: Array<
    Collision & {
      overlapArea: number;
      containerArea: number;
      depth: number;
      overlapRatio: number;
      score: number;
      isZeroDimension: boolean;
    }
  > = [];

  // Check if the dragged object has zero dimensions
  const draggedWidth = collisionRect.right - collisionRect.left;
  const draggedHeight = collisionRect.bottom - collisionRect.top;
  const isZeroDimension = draggedWidth === 0 || draggedHeight === 0;

  const draggedArea = getRectArea(collisionRect);
  const minScoreThreshold = isZeroDimension ? MIN_DEEPER_ZERO_DIMENSION_SCORE : MIN_DEEPER_OVERLAP;
  // Dnd-kit registers unique container IDs; multiple IDs may share a DOM node.
  // Index once instead of scanning every container for every candidate's depth.
  const containerCounts = new Map<Element, number>();
  for (const container of droppableContainers) {
    const node = container.node.current;
    if (node) containerCounts.set(node, (containerCounts.get(node) ?? 0) + 1);
  }

  // Iterate through all droppable containers
  for (const container of droppableContainers) {
    const { id, disabled } = container;

    // Skip disabled containers and self
    if (disabled || id === active.id) {
      continue;
    }

    const rect = droppableRects.get(id);
    if (!rect) {
      continue;
    }

    // Check for intersection using appropriate method
    const hasCollision = hasIntersection(collisionRect, rect);

    if (!hasCollision) {
      continue;
    }

    // Calculate metrics based on whether dragged object has zero dimensions
    let overlapArea: number;
    let overlapRatio: number;
    let score: number;
    const containerArea = getRectArea(rect);

    if (isZeroDimension) {
      // For zero-dimension objects, use distance-based scoring
      overlapArea = 0;
      score = getZeroDimensionScore(collisionRect, rect);
      overlapRatio = score; // Use score as ratio equivalent
    } else {
      // Standard overlap calculation for normal rectangles
      overlapArea = getOverlapArea(collisionRect, rect);

      // Calculate overlap ratio based on the smaller area for better accuracy
      const referenceArea = Math.min(draggedArea, containerArea);
      overlapRatio = referenceArea > 0 ? overlapArea / referenceArea : 0;
      score = overlapRatio;
    }

    const depth = getContainerDepth(container, containerCounts);

    collisions.push({
      id,
      overlapArea,
      containerArea,
      depth,
      overlapRatio,
      score,
      isZeroDimension,
      data: {
        droppableContainer: container,
        value: isZeroDimension ? score * ZERO_DIMENSION_VALUE_SCALE : overlapArea, // Scale score for zero-dimension objects
      },
    });
  }

  // Return empty array if no collisions
  if (collisions.length === 0) {
    return [];
  }

  // Multi-layer sorting strategy
  collisions.sort((a, b) => {
    // 1. First sort by nesting depth (higher depth takes priority)
    if (a.depth !== b.depth) {
      return b.depth - a.depth;
    }

    // 2. Then sort by score/overlap ratio (higher score takes priority)
    if (Math.abs(a.score - b.score) > SCORE_TOLERANCE) {
      return b.score - a.score;
    }

    // 3. Finally sort by container area (smaller area takes priority for more precision)
    return a.containerArea - b.containerArea;
  });

  // Filter out containers that are completely contained by deeper containers
  const filteredCollisions: Collision[] = [];

  for (let i = 0; i < collisions.length; i++) {
    const currentCollision = collisions[i];
    const currentContainer = currentCollision.data!.droppableContainer as DroppableContainer;

    let isContainedByDeeper = false;

    // Check if contained by a deeper container
    for (let j = 0; j < i; j++) {
      const deeperCollision = collisions[j];
      const deeperContainer = deeperCollision.data!.droppableContainer as DroppableContainer;

      // If deeper container is an ancestor of current container and has sufficient overlap
      if (
        isAncestor(currentContainer, deeperContainer) &&
        deeperCollision.score > minScoreThreshold
      ) {
        isContainedByDeeper = true;
        break;
      }
    }

    if (!isContainedByDeeper) {
      filteredCollisions.push({
        id: currentCollision.id,
        data: currentCollision.data,
      });
    }
  }

  return filteredCollisions;
};

/**
 * Factory function to create customized collision detection with options
 */
export const createNestedCollisionDetection = (options?: {
  minOverlapRatio?: number;
  minZeroDimensionScore?: number;
  preferSmallerContainers?: boolean;
  maxResults?: number;
  usePointerPosition?: boolean;
}) => {
  const {
    minOverlapRatio = 0.1,
    minZeroDimensionScore = 0.2,
    maxResults = 5,
    usePointerPosition = false,
  } = options || {};

  const customCollisionDetection: CollisionDetection = (args) => {
    let collisions = nestedOverlapCollisionDetection(args);

    // Apply minimum score/overlap ratio filtering
    collisions = collisions.filter((collision) => {
      const rect = args.droppableRects.get(collision.id);
      if (!rect) return false;

      const draggedWidth = args.collisionRect.right - args.collisionRect.left;
      const draggedHeight = args.collisionRect.bottom - args.collisionRect.top;
      const isZeroDimension = draggedWidth === 0 || draggedHeight === 0;

      if (isZeroDimension) {
        const score = getZeroDimensionScore(args.collisionRect, rect);
        return score >= minZeroDimensionScore;
      } else {
        const overlapArea = getOverlapArea(args.collisionRect, rect);
        const containerArea = getRectArea(rect);
        const overlapRatio = containerArea > 0 ? overlapArea / containerArea : 0;
        return overlapRatio >= minOverlapRatio;
      }
    });

    // Use pointer position as fallback for zero-dimension objects if enabled
    if (usePointerPosition && args.pointerCoordinates && collisions.length === 0) {
      const draggedWidth = args.collisionRect.right - args.collisionRect.left;
      const draggedHeight = args.collisionRect.bottom - args.collisionRect.top;

      if (draggedWidth === 0 || draggedHeight === 0) {
        // Fallback: check if pointer is inside any container
        for (const container of args.droppableContainers) {
          if (container.disabled || container.id === args.active.id) continue;
          const rect = args.droppableRects.get(container.id);
          if (rect && isPointInRect(args.pointerCoordinates.x, args.pointerCoordinates.y, rect)) {
            collisions.push({
              id: container.id,
              data: {
                droppableContainer: container,
                value: 1,
              },
            });
          }
        }
      }
    }

    // Limit number of results
    return collisions.slice(0, maxResults);
  };

  return customCollisionDetection;
};
