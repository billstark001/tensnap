// #region Interfaces and Types

export interface Rectangle {
  type: string;
  width: number;
  height: number;
  left?: number;
  top?: number;
}

export interface PlacedRectangle extends Rectangle {
  left: number;
  top: number;
}

export interface PackingOptions {
  containerWidth?: number; // optional, will be calculated if not provided
  containerHeight?: number; // optional, will be calculated if not provided
  targetAspectRatio?: number; // width/height ratio, default is 16/9 or container ratio
  groupByType?: boolean; // whether to group rectangles by type
  preservePosition?: boolean; // whether to try preserving existing positions
  padding?: number; // padding between rectangles
  inPlace?: boolean; // whether to modify rectangles in place (true) or create new objects (false)
}

export interface PackingResult {
  rectangles: PlacedRectangle[];
  suggestedContainerWidth: number;
  suggestedContainerHeight: number;
  actualBounds: { width: number; height: number };
}

interface RequiredPackingOptions extends Required<Omit<PackingOptions, 'containerWidth' | 'containerHeight'>> {
  containerWidth: number;
  containerHeight: number;
}

// #endregion

// #region Shelf Class

// Shelf class
export class Shelf {
  public x: number = 0;
  public height: number = 0;
  private maxWidth: number;

  constructor(
    maxWidth: number,
    public y: number
  ) {
    this.maxWidth = maxWidth;
  }

  /**
   * Checks if the shelf can fit a rectangle
   */
  canFit(width: number, _height: number, padding: number): boolean {
    return this.x + width + padding <= this.maxWidth;
  }

  /**
   * Places a rectangle on the shelf
   */
  place(rect: Rectangle, padding: number, inPlace: boolean): PlacedRectangle {
    const placed: PlacedRectangle = inPlace ? 
      (rect as PlacedRectangle) : { ...rect, left: 0, top: 0 };
    
    placed.left = this.x;
    placed.top = this.y;

    this.x += rect.width + padding;
    this.height = Math.max(this.height, rect.height);

    return placed;
  }

  /**
   * Places a rectangle at preferred X position if possible
   */
  placeAtPreferredX(rect: Rectangle, preferredX: number, padding: number, inPlace: boolean): PlacedRectangle {
    // Try to place at preferred X if there's space
    const targetX = Math.max(this.x, preferredX);
    
    if (targetX + rect.width <= this.maxWidth) {
      const placed: PlacedRectangle = inPlace ? 
        (rect as PlacedRectangle) : { ...rect, left: 0, top: 0 };
      
      placed.left = targetX;
      placed.top = this.y;

      this.x = Math.max(this.x, targetX + rect.width + padding);
      this.height = Math.max(this.height, rect.height);

      return placed;
    }

    // Fall back to normal placement
    return this.place(rect, padding, inPlace);
  }
}

// #endregion

// #region Helper Functions

/**
 * Calculates suggested container dimensions based on rectangles
 */
function calculateSuggestedDimensions(rectangles: Rectangle[], targetAspectRatio: number, padding: number): { width: number; height: number } {
  if (rectangles.length === 0) {
    return { width: 800, height: 600 }; // Default dimensions
  }

  const totalArea = rectangles.reduce((sum, rect) => sum + rect.width * rect.height, 0);
  const totalPaddingArea = rectangles.length * padding * padding;
  const adjustedArea = totalArea + totalPaddingArea;
  
  // Calculate dimensions based on target aspect ratio
  const height = Math.sqrt(adjustedArea / targetAspectRatio);
  const width = height * targetAspectRatio;
  
  // Ensure minimum size based on largest rectangle
  const maxRectWidth = Math.max(...rectangles.map(r => r.width));
  const maxRectHeight = Math.max(...rectangles.map(r => r.height));
  
  return {
    width: Math.max(width, maxRectWidth + padding * 2),
    height: Math.max(height, maxRectHeight + padding * 2)
  };
}

// Helper function to normalize options
function normalizeOptions(rectangles: Rectangle[], options: PackingOptions): RequiredPackingOptions {
  const defaultAspectRatio = 16 / 9;
  const targetAspectRatio = options.targetAspectRatio || 
    (options.containerWidth && options.containerHeight ? 
      options.containerWidth / options.containerHeight : defaultAspectRatio);

  let containerWidth = options.containerWidth;
  let containerHeight = options.containerHeight;

  // Calculate container dimensions if not provided
  if (!containerWidth || !containerHeight) {
    const suggested = calculateSuggestedDimensions(rectangles, targetAspectRatio, options.padding || 0);
    containerWidth = containerWidth || suggested.width;
    containerHeight = containerHeight || suggested.height;
  }

  return {
    containerWidth,
    containerHeight,
    targetAspectRatio,
    groupByType: options.groupByType ?? true,
    preservePosition: options.preservePosition ?? false,
    padding: options.padding || 0,
    inPlace: options.inPlace ?? false
  };
}

/**
 * Groups rectangles by type while maintaining order
 */
export function groupRectanglesByType(rectangles: Rectangle[]): Rectangle[] {
  const typeMap = new Map<string, Rectangle[]>();
  
  for (const rect of rectangles) {
    if (!typeMap.has(rect.type)) {
      typeMap.set(rect.type, []);
    }
    typeMap.get(rect.type)!.push(rect);
  }

  const result: Rectangle[] = [];
  for (const group of typeMap.values()) {
    result.push(...group);
  }
  
  return result;
}

/**
 * Groups rectangles by type while preserving relative order within types
 */
export function groupRectanglesByTypePreservingOrder(rectangles: PlacedRectangle[]): PlacedRectangle[][] {
  const typeMap = new Map<string, PlacedRectangle[]>();
  
  for (const rect of rectangles) {
    if (!typeMap.has(rect.type)) {
      typeMap.set(rect.type, []);
    }
    typeMap.get(rect.type)!.push(rect);
  }

  return Array.from(typeMap.values());
}

/**
 * Gets the Y position for the next shelf (optimized to avoid recalculation)
 */
export function getNextShelfY(shelves: Shelf[], padding: number): number {
  if (shelves.length === 0) return 0;
  
  // Use cached max Y if available, otherwise calculate
  let maxY = 0;
  for (const shelf of shelves) {
    const shelfBottom = shelf.y + shelf.height;
    if (shelfBottom > maxY) {
      maxY = shelfBottom;
    }
  }
  
  return maxY + padding;
}

// #endregion

// #region Core Packing Functions

/**
 * Places a rectangle using shelf-based algorithm
 */
export function placeRectangle(
  rect: Rectangle, 
  shelves: Shelf[], 
  options: RequiredPackingOptions
): PlacedRectangle {
  // Try to find an existing shelf that can accommodate the rectangle
  for (const shelf of shelves) {
    if (shelf.canFit(rect.width, rect.height, options.padding)) {
      return shelf.place(rect, options.padding, options.inPlace);
    }
  }

  // Create a new shelf
  const newShelf = new Shelf(options.containerWidth, getNextShelfY(shelves, options.padding));
  shelves.push(newShelf);
  return newShelf.place(rect, options.padding, options.inPlace);
}

/**
 * Places a rectangle near its original position
 */
export function placeRectangleNearOriginalPosition(
  rect: PlacedRectangle, 
  shelves: Shelf[], 
  options: RequiredPackingOptions
): PlacedRectangle {
  const originalLeft = rect.left;
  const originalTop = rect.top;
  
  // Try to find a shelf close to the original Y position
  let bestShelf: Shelf | null = null;
  let minDistanceY = Infinity;
  
  for (const shelf of shelves) {
    if (shelf.canFit(rect.width, rect.height, options.padding)) {
      const distanceY = Math.abs(shelf.y - originalTop);
      if (distanceY < minDistanceY) {
        minDistanceY = distanceY;
        bestShelf = shelf;
      }
    }
  }

  if (bestShelf) {
    // Try to place at preferred X position
    return bestShelf.placeAtPreferredX(rect, originalLeft, options.padding, options.inPlace);
  }

  // Create new shelf close to original position if possible
  const targetY = Math.min(originalTop, getNextShelfY(shelves, options.padding));
  const newShelf = new Shelf(options.containerWidth, targetY);
  shelves.push(newShelf);
  return newShelf.placeAtPreferredX(rect, originalLeft, options.padding, options.inPlace);
}

/**
 * Calculates the bounding box of all rectangles
 */
export function calculateBounds(rectangles: PlacedRectangle[]): { width: number; height: number } {
  if (rectangles.length === 0) return { width: 0, height: 0 };
  
  let maxX = 0;
  let maxY = 0;
  
  for (const rect of rectangles) {
    const rectRight = rect.left + rect.width;
    const rectBottom = rect.top + rect.height;
    if (rectRight > maxX) maxX = rectRight;
    if (rectBottom > maxY) maxY = rectBottom;
  }
  
  return { width: maxX, height: maxY };
}

/**
 * Optimizes the final layout to improve space utilization
 */
export function optimizeLayout(
  rectangles: PlacedRectangle[], 
  options: RequiredPackingOptions
): PlacedRectangle[] {
  // Calculate current bounding box
  const bounds = calculateBounds(rectangles);
  const currentAspectRatio = bounds.width / bounds.height;
  
  // If aspect ratio is close to target, return as is
  if (Math.abs(currentAspectRatio - options.targetAspectRatio) < 0.1) {
    return rectangles;
  }

  // Apply scaling to better fit target aspect ratio
  const scale = Math.sqrt(options.targetAspectRatio / currentAspectRatio);
  const scaleX = scale > 1 ? scale : 1;
  const scaleY = scale < 1 ? 1 / scale : 1;

  if (options.inPlace) {
    // Modify in place
    for (const rect of rectangles) {
      rect.left *= scaleX;
      rect.top *= scaleY;
    }
    return rectangles;
  } else {
    // Create new objects
    return rectangles.map(rect => ({
      ...rect,
      left: rect.left * scaleX,
      top: rect.top * scaleY
    }));
  }
}

// #endregion

// #region Main Packing Algorithms

/**
 * Initial packing algorithm - places rectangles from scratch
 */
export function initialPack(rectangles: Rectangle[], options: PackingOptions): PackingResult {
  const normalizedOptions = normalizeOptions(rectangles, options);
  const result: PlacedRectangle[] = [];
  let processedRects = options.inPlace ? rectangles : [...rectangles];

  // Group rectangles by type if enabled
  if (normalizedOptions.groupByType) {
    processedRects = groupRectanglesByType(processedRects);
  }

  // Sort rectangles by area (largest first) for better space utilization
  processedRects.sort((a, b) => (b.width * b.height) - (a.width * a.height));

  // Use shelf-based packing algorithm
  const shelves: Shelf[] = [];
  
  for (const rect of processedRects) {
    const placed = placeRectangle(rect, shelves, normalizedOptions);
    result.push(placed);
  }

  const optimizedResult = optimizeLayout(result, normalizedOptions);
  const actualBounds = calculateBounds(optimizedResult);
  
  return {
    rectangles: optimizedResult,
    suggestedContainerWidth: Math.max(normalizedOptions.containerWidth, actualBounds.width),
    suggestedContainerHeight: Math.max(normalizedOptions.containerHeight, actualBounds.height),
    actualBounds
  };
}

/**
 * Adjusts existing layout while trying to preserve positions
 */
export function adjustLayout(rectangles: PlacedRectangle[], options: PackingOptions): PackingResult {
  const normalizedOptions = normalizeOptions(rectangles, options);
  const result: PlacedRectangle[] = [];
  
  // Sort rectangles by their current position (top-to-bottom, left-to-right)
  const sortedRects = options.inPlace ? rectangles : [...rectangles];
  sortedRects.sort((a, b) => {
    if (Math.abs(a.top - b.top) < normalizedOptions.padding) {
      return a.left - b.left;
    }
    return a.top - b.top;
  });

  // Group by type while maintaining relative order
  const typeGroups = normalizedOptions.groupByType ? 
    groupRectanglesByTypePreservingOrder(sortedRects) : 
    [sortedRects];

  const shelves: Shelf[] = [];
  
  for (const group of typeGroups) {
    for (const rect of group) {
      // Try to place near original position
      const placed = placeRectangleNearOriginalPosition(rect, shelves, normalizedOptions);
      result.push(placed);
    }
  }

  const optimizedResult = optimizeLayout(result, normalizedOptions);
  const actualBounds = calculateBounds(optimizedResult);
  
  return {
    rectangles: optimizedResult,
    suggestedContainerWidth: Math.max(normalizedOptions.containerWidth, actualBounds.width),
    suggestedContainerHeight: Math.max(normalizedOptions.containerHeight, actualBounds.height),
    actualBounds
  };
}

/**
 * Main packing function that handles both initial packing and position-preserving adjustment
 */
export function packRectangles(rectangles: Rectangle[], options: PackingOptions = {}): PackingResult {
  const normalizedOptions = normalizeOptions(rectangles, options);
  
  if (normalizedOptions.preservePosition && rectangles.some(r => r.left !== undefined && r.top !== undefined)) {
    return adjustLayout(rectangles as PlacedRectangle[], options);
  } else {
    return initialPack(rectangles, options);
  }
}

// #endregion