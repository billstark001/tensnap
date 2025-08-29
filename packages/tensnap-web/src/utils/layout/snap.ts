// Types for guide lines and snap configuration
export interface GuidePoint {
  x: number;
  y: number;
}

export interface GuidePointSet {
  horizontal: GuidePoint[];
  vertical: GuidePoint[];
}

export interface SnapResult {
  x: number;
  y: number;
  snappedToGuide: boolean;
  snappedToGrid: boolean;
  horizontalGuideIndex?: number; // Index of snapped horizontal guide, -1 if none
  verticalGuideIndex?: number;   // Index of snapped vertical guide, -1 if none
}

export interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapConfig extends GuidePointSet {
  enableGrid: boolean;
  gridSize: number;
  snapThreshold: number; // Maximum distance to snap
}

export class SnapModule {
  private config: SnapConfig;
  // Cache for frequently used calculations
  private gridSizeInv: number = 1;

  constructor(config: SnapConfig) {
    this.config = config;
    this.updateCachedValues();
  }

  /**
   * Update snap configuration
   */
  updateConfig(config: Partial<SnapConfig>): void {
    this.config = { ...this.config, ...config };
    this.updateCachedValues();
  }

  /**
   * Update cached values for performance optimization
   */
  private updateCachedValues(): void {
    this.gridSizeInv = 1 / this.config.gridSize;
  }

  /**
   * Snap a point to guides or grid
   * @param x - Current x coordinate
   * @param y - Current y coordinate
   * @returns Snapped coordinates and snap information
   */
  snapPoint(x: number, y: number): SnapResult {
    let snappedX = x;
    let snappedY = y;
    let snappedToGuide = false;
    let snappedToGrid = false;
    let horizontalGuideIndex: number | undefined;
    let verticalGuideIndex: number | undefined;

    // Try to snap to guides first (guides have priority)
    // Inline guide snapping for better performance
    const threshold = this.config.snapThreshold;
    
    // Snap to vertical guides (affects x coordinate)
    for (let i = 0; i < this.config.vertical.length; i++) {
      const guide = this.config.vertical[i];
      const distance = Math.abs(x - guide.x);
      if (distance <= threshold) {
        snappedX = guide.x;
        snappedToGuide = true;
        verticalGuideIndex = i;
        break; // Use the first guide within threshold
      }
    }

    // Snap to horizontal guides (affects y coordinate)
    for (let i = 0; i < this.config.horizontal.length; i++) {
      const guide = this.config.horizontal[i];
      const distance = Math.abs(y - guide.y);
      if (distance <= threshold) {
        snappedY = guide.y;
        snappedToGuide = true;
        horizontalGuideIndex = i;
        break; // Use the first guide within threshold
      }
    }

    // If not snapped to guides, try grid snapping
    if (!snappedToGuide && this.config.enableGrid) {
      const gridSize = this.config.gridSize;
      snappedX = Math.round(x * this.gridSizeInv) * gridSize;
      snappedY = Math.round(y * this.gridSizeInv) * gridSize;
      snappedToGrid = true;
    }

    return {
      x: snappedX,
      y: snappedY,
      snappedToGuide,
      snappedToGrid,
      horizontalGuideIndex,
      verticalGuideIndex
    };
  }

  /**
   * Snap a rectangle to guides or grid
   * Rectangle can snap by its edges, center, or corners
   * @param rect - Rectangle to snap
   * @returns Snapped rectangle position and snap information
   */
  snapRectangle(rect: Rectangle): SnapResult {
    const { x, y, width, height } = rect;

    // Pre-calculate commonly used values
    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;
    const right = x + width;
    const bottom = y + height;
    const centerX = x + halfWidth;
    const centerY = y + halfHeight;

    // Define key points of the rectangle for snapping (avoiding object allocation)
    const keyPoints = [
      [x, y],                    // Top-left corner
      [right, y],                // Top-right corner  
      [x, bottom],               // Bottom-left corner
      [right, bottom],           // Bottom-right corner
      [centerX, y],              // Top edge center
      [centerX, bottom],         // Bottom edge center
      [x, centerY],              // Left edge center
      [right, centerY],          // Right edge center
      [centerX, centerY]         // Rectangle center
    ] as const;

    let bestSnapResult: SnapResult | null = null;
    let bestPointIndex = -1;
    let minDistanceSquared = Infinity;

    // Try snapping each key point and find the best one
    for (let i = 0; i < keyPoints.length; i++) {
      const [pointX, pointY] = keyPoints[i];
      const snapResult = this.snapPoint(pointX, pointY);

      if (snapResult.snappedToGuide || snapResult.snappedToGrid) {
        // Use squared distance to avoid expensive sqrt calculation
        const deltaX = snapResult.x - pointX;
        const deltaY = snapResult.y - pointY;
        const distanceSquared = deltaX * deltaX + deltaY * deltaY;

        if (distanceSquared < minDistanceSquared) {
          minDistanceSquared = distanceSquared;
          bestSnapResult = snapResult;
          bestPointIndex = i;
        }
      }
    }

    // Calculate new rectangle position based on the best snap
    if (bestSnapResult && bestPointIndex >= 0) {
      const [originalX, originalY] = keyPoints[bestPointIndex];
      const deltaX = bestSnapResult.x - originalX;
      const deltaY = bestSnapResult.y - originalY;

      return {
        x: x + deltaX,
        y: y + deltaY,
        snappedToGuide: bestSnapResult.snappedToGuide,
        snappedToGrid: bestSnapResult.snappedToGrid,
        horizontalGuideIndex: bestSnapResult.horizontalGuideIndex,
        verticalGuideIndex: bestSnapResult.verticalGuideIndex
      };
    }

    // No snapping occurred
    return {
      x,
      y,
      snappedToGuide: false,
      snappedToGrid: false,
      horizontalGuideIndex: undefined,
      verticalGuideIndex: undefined
    };
  }

  /**
   * Snap point to guide lines
   * @param x - Current x coordinate
   * @param y - Current y coordinate
   * @returns Snap result with coordinates and snap status
   */
  snapToGuides(x: number, y: number): {
    x: number;
    y: number;
    snapped: boolean;
    horizontalGuideIndex?: number;
    verticalGuideIndex?: number;
  } {
    let snappedX = x;
    let snappedY = y;
    let snapped = false;
    let horizontalGuideIndex: number | undefined;
    let verticalGuideIndex: number | undefined;

    // Snap to vertical guides (affects x coordinate)
    for (let i = 0; i < this.config.vertical.length; i++) {
      const guide = this.config.vertical[i];
      if (Math.abs(x - guide.x) <= this.config.snapThreshold) {
        snappedX = guide.x;
        snapped = true;
        verticalGuideIndex = i;
        break; // Use the first guide within threshold
      }
    }

    // Snap to horizontal guides (affects y coordinate)
    for (let i = 0; i < this.config.horizontal.length; i++) {
      const guide = this.config.horizontal[i];
      if (Math.abs(y - guide.y) <= this.config.snapThreshold) {
        snappedY = guide.y;
        snapped = true;
        horizontalGuideIndex = i;
        break; // Use the first guide within threshold
      }
    }

    return {
      x: snappedX,
      y: snappedY,
      snapped,
      horizontalGuideIndex,
      verticalGuideIndex
    };
  }

  /**
   * Snap point to grid
   * @param x - Current x coordinate
   * @param y - Current y coordinate
   * @returns Grid-snapped coordinates
   */
  snapToGrid(x: number, y: number): { x: number; y: number } {
    const gridSize = this.config.gridSize;

    return {
      x: Math.round(x * this.gridSizeInv) * gridSize,
      y: Math.round(y * this.gridSizeInv) * gridSize
    };
  }

  /**
   * Get all guide lines that are within snap threshold of a point
   * Useful for highlighting guides during drag operations
   * @param x - Current x coordinate
   * @param y - Current y coordinate
   * @returns Arrays of nearby horizontal and vertical guides
   */
  getNearbyGuides(x: number, y: number): {
    horizontal: GuidePoint[];
    vertical: GuidePoint[];
  } {
    const threshold = this.config.snapThreshold;
    const nearbyHorizontal: GuidePoint[] = [];
    const nearbyVertical: GuidePoint[] = [];

    // Use for loops for better performance than filter
    for (let i = 0; i < this.config.horizontal.length; i++) {
      const guide = this.config.horizontal[i];
      if (Math.abs(y - guide.y) <= threshold) {
        nearbyHorizontal.push(guide);
      }
    }

    for (let i = 0; i < this.config.vertical.length; i++) {
      const guide = this.config.vertical[i];
      if (Math.abs(x - guide.x) <= threshold) {
        nearbyVertical.push(guide);
      }
    }

    return {
      horizontal: nearbyHorizontal,
      vertical: nearbyVertical
    };
  }

  /**
   * Check if a point would snap to any guide or grid
   * @param x - Current x coordinate
   * @param y - Current y coordinate
   * @returns Whether the point would snap
   */
  wouldSnap(x: number, y: number): boolean {
    const threshold = this.config.snapThreshold;

    // Check guides first (faster than grid calculation)
    for (let i = 0; i < this.config.vertical.length; i++) {
      if (Math.abs(x - this.config.vertical[i].x) <= threshold) {
        return true;
      }
    }

    for (let i = 0; i < this.config.horizontal.length; i++) {
      if (Math.abs(y - this.config.horizontal[i].y) <= threshold) {
        return true;
      }
    }

    // Check grid if enabled
    if (this.config.enableGrid) {
      const gridSize = this.config.gridSize;
      const snappedX = Math.round(x * this.gridSizeInv) * gridSize;
      const snappedY = Math.round(y * this.gridSizeInv) * gridSize;
      return snappedX !== x || snappedY !== y;
    }

    return false;
  }

  /**
   * Fast check if a rectangle would snap without calculating exact position
   * Useful for optimization in drag operations
   * @param rect - Rectangle to check
   * @returns Whether the rectangle would snap
   */
  wouldRectangleSnap(rect: Rectangle): boolean {
    const { x, y, width, height } = rect;
    
    // Check key points efficiently
    const keyPoints = [
      [x, y],                               // Top-left
      [x + width, y],                       // Top-right
      [x, y + height],                      // Bottom-left
      [x + width, y + height],              // Bottom-right
      [x + width * 0.5, y + height * 0.5]  // Center
    ] as const;

    for (let i = 0; i < keyPoints.length; i++) {
      const [pointX, pointY] = keyPoints[i];
      if (this.wouldSnap(pointX, pointY)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Optimized snap point that only returns coordinates (no metadata)
   * Use this for performance-critical scenarios where you only need position
   * @param x - Current x coordinate
   * @param y - Current y coordinate
   * @returns Snapped coordinates only
   */
  snapPointFast(x: number, y: number): { x: number; y: number } {
    const threshold = this.config.snapThreshold;
    let snappedX = x;
    let snappedY = y;
    let hasSnapped = false;

    // Snap to vertical guides
    for (let i = 0; i < this.config.vertical.length; i++) {
      const guide = this.config.vertical[i];
      if (Math.abs(x - guide.x) <= threshold) {
        snappedX = guide.x;
        hasSnapped = true;
        break;
      }
    }

    // Snap to horizontal guides
    for (let i = 0; i < this.config.horizontal.length; i++) {
      const guide = this.config.horizontal[i];
      if (Math.abs(y - guide.y) <= threshold) {
        snappedY = guide.y;
        hasSnapped = true;
        break;
      }
    }

    // If not snapped to guides and grid is enabled
    if (!hasSnapped && this.config.enableGrid) {
      const gridSize = this.config.gridSize;
      snappedX = Math.round(x * this.gridSizeInv) * gridSize;
      snappedY = Math.round(y * this.gridSizeInv) * gridSize;
    }

    return { x: snappedX, y: snappedY };
  }
}

// Usage example:
/*
const snapModule = new SnapModule({
  enableGrid: true,
  gridSize: 20,
  snapThreshold: 10,
  horizontal: [
    { x: 0, y: 100 },
    { x: 0, y: 200 }
  ],
  vertical: [
    { x: 150, y: 0 },
    { x: 300, y: 0 }
  ]
});

// Snap a point during drag
const pointSnapResult = snapModule.snapPoint(152, 98);
console.log(pointSnapResult); 
// { x: 150, y: 100, snappedToGuide: true, snappedToGrid: false, horizontalGuideIndex: 0, verticalGuideIndex: 0 }

// Snap a rectangle during drag
const rectSnapResult = snapModule.snapRectangle({
  x: 145,
  y: 95,
  width: 50,
  height: 30
});
console.log(rectSnapResult); 
// { x: 150, y: 100, snappedToGuide: true, snappedToGrid: false, horizontalGuideIndex: 0, verticalGuideIndex: 0 }
*/