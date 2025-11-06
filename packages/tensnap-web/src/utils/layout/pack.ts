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
  containerWidth?: number;
  containerHeight?: number;
  targetAspectRatio?: number; // default is 16/9
  groupByType?: boolean;
  preservePosition?: boolean;
  padding?: number;
  paddingBorder?: number | [number, number];
  inPlace?: boolean;
}

export interface PackingResult {
  rectangles: PlacedRectangle[];
  suggestedContainerWidth: number;
  suggestedContainerHeight: number;
  actualBounds: { width: number; height: number };
}

// #endregion

// #region Shelf Class

export class Shelf {
  public x: number = 0;
  public height: number = 0;
  private maxWidth: number;

  constructor(maxWidth: number, public y: number) {
    this.maxWidth = maxWidth;
  }

  canFit(width: number, padding: number): boolean {
    return this.x + width + padding <= this.maxWidth;
  }

  place(rect: Rectangle, padding: number, inPlace: boolean): PlacedRectangle {
    const placed: PlacedRectangle = inPlace ?
      (rect as PlacedRectangle) : { ...rect, left: 0, top: 0 };

    placed.left = this.x;
    placed.top = this.y;

    this.x += rect.width + padding;
    this.height = Math.max(this.height, rect.height);

    return placed;
  }

  placeAtPreferredX(rect: Rectangle, preferredX: number, padding: number, inPlace: boolean): PlacedRectangle {
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

    return this.place(rect, padding, inPlace);
  }
}

// #endregion

// #region Helper Functions

function calculateSuggestedDimensions(rectangles: Rectangle[], targetAspectRatio: number | undefined, padding: number): { width: number; height: number } {
  if (rectangles.length === 0) return { width: 80, height: 60 };

  const totalArea = rectangles.reduce((sum, rect) => sum + rect.width * rect.height, 0);
  const adjustedArea = totalArea * 1.2; // Add 20% for padding and spacing

  const height = targetAspectRatio ? Math.sqrt(adjustedArea / targetAspectRatio) : 60;
  const width = targetAspectRatio ? height * targetAspectRatio : 80;

  const maxRectWidth = Math.max(...rectangles.map(r => r.width));
  const maxRectHeight = Math.max(...rectangles.map(r => r.height));

  return {
    width: Math.max(width, maxRectWidth + padding * 2),
    height: Math.max(height, maxRectHeight + padding * 2)
  };
}

function normalizeOptions(rectangles: Rectangle[], options: PackingOptions) {
  const targetAspectRatio = options.targetAspectRatio;

  let containerWidth = options.containerWidth;
  let containerHeight = options.containerHeight;

  if (!containerWidth || !containerHeight) {
    const suggested = calculateSuggestedDimensions(rectangles, targetAspectRatio, options.padding || 10);
    containerWidth = containerWidth || suggested.width;
    containerHeight = containerHeight || suggested.height;
  }

  const [paddingBorderY, paddingBorderX] = Array.isArray(options.paddingBorder) ?
    options.paddingBorder :
    [options.paddingBorder || 0, options.paddingBorder || 0];

  return {
    containerWidth,
    containerHeight,
    targetAspectRatio,
    groupByType: options.groupByType ?? true,
    preservePosition: options.preservePosition ?? false,
    padding: options.padding || 10,
    paddingBorderX,
    paddingBorderY,
    inPlace: options.inPlace ?? false
  };
}

type NormalizedPackingOptions = ReturnType<typeof normalizeOptions>;

export function groupRectanglesByType(rectangles: Rectangle[]): Rectangle[] {
  const typeGroups = new Map<string, Rectangle[]>();

  for (const rect of rectangles) {
    if (!typeGroups.has(rect.type)) {
      typeGroups.set(rect.type, []);
    }
    typeGroups.get(rect.type)!.push(rect);
  }

  return Array.from(typeGroups.values()).flat();
}

function getNextShelfY(shelves: Shelf[], padding: number): number {
  if (shelves.length === 0) return 0;

  let maxY = 0;
  for (const shelf of shelves) {
    maxY = Math.max(maxY, shelf.y + shelf.height);
  }

  return maxY + padding;
}

// #endregion

// #region Core Packing Functions

function placeRectangle(rect: Rectangle, shelves: Shelf[], options: NormalizedPackingOptions): PlacedRectangle {
  for (const shelf of shelves) {
    if (shelf.canFit(rect.width, options.padding)) {
      return shelf.place(rect, options.padding, options.inPlace);
    }
  }

  const newShelf = new Shelf(options.containerWidth, getNextShelfY(shelves, options.padding));
  shelves.push(newShelf);
  return newShelf.place(rect, options.padding, options.inPlace);
}

function placeRectangleNearOriginalPosition(rect: PlacedRectangle, shelves: Shelf[], options: NormalizedPackingOptions): PlacedRectangle {
  let bestShelf: Shelf | null = null;
  let minDistanceY = Infinity;

  for (const shelf of shelves) {
    if (shelf.canFit(rect.width, options.padding)) {
      const distanceY = Math.abs(shelf.y - rect.top);
      if (distanceY < minDistanceY) {
        minDistanceY = distanceY;
        bestShelf = shelf;
      }
    }
  }

  if (bestShelf) {
    return bestShelf.placeAtPreferredX(rect, rect.left, options.padding, options.inPlace);
  }

  const newShelf = new Shelf(options.containerWidth, getNextShelfY(shelves, options.padding));
  shelves.push(newShelf);
  return newShelf.placeAtPreferredX(rect, rect.left, options.padding, options.inPlace);
}

export function calculateBounds(rectangles: PlacedRectangle[], paddingBorderX: number = 0, paddingBorderY: number = 0): { width: number; height: number } {
  if (rectangles.length === 0) return { width: paddingBorderX, height: paddingBorderY };

  let maxX = 0;
  let maxY = 0;

  for (const rect of rectangles) {
    maxX = Math.max(maxX, rect.left + rect.width);
    maxY = Math.max(maxY, rect.top + rect.height);
  }

  return { width: maxX + paddingBorderX, height: maxY + paddingBorderY };
}

// #endregion

// #region Main Packing Algorithms

export function initialPack(rectangles: Rectangle[], options: PackingOptions): PackingResult {
  const normalizedOptions = normalizeOptions(rectangles, options);
  let processedRects = options.inPlace ? rectangles : [...rectangles];

  if (normalizedOptions.groupByType) {
    processedRects = groupRectanglesByType(processedRects);
  }

  // Sort by area (largest first)
  processedRects.sort((a, b) => (b.width * b.height) - (a.width * a.height));

  const shelves: Shelf[] = [];
  const result: PlacedRectangle[] = [];

  for (const rect of processedRects) {
    result.push(placeRectangle(rect, shelves, normalizedOptions));
  }

  if (normalizedOptions.paddingBorderX || normalizedOptions.paddingBorderY) {
    for (const rect of result) {
      rect.left += normalizedOptions.paddingBorderX;
      rect.top += normalizedOptions.paddingBorderY;
    }
  }

  const actualBounds = calculateBounds(result, normalizedOptions.paddingBorderX, normalizedOptions.paddingBorderY);

  return {
    rectangles: result,
    suggestedContainerWidth: Math.max(normalizedOptions.containerWidth, actualBounds.width),
    suggestedContainerHeight: Math.max(normalizedOptions.containerHeight, actualBounds.height),
    actualBounds
  };
}

export function adjustLayout(rectangles: PlacedRectangle[], options: PackingOptions): PackingResult {
  const normalizedOptions = normalizeOptions(rectangles, options);

  const sortedRects = options.inPlace ? rectangles : [...rectangles];
  sortedRects.sort((a, b) => {
    const deltaY = Math.abs(a.top - b.top);
    return deltaY < normalizedOptions.padding ? a.left - b.left : a.top - b.top;
  });

  const shelves: Shelf[] = [];
  const result: PlacedRectangle[] = [];

  if (normalizedOptions.groupByType) {
    const typeGroups = new Map<string, PlacedRectangle[]>();

    for (const rect of sortedRects) {
      if (!typeGroups.has(rect.type)) {
        typeGroups.set(rect.type, []);
      }
      typeGroups.get(rect.type)!.push(rect);
    }

    for (const group of typeGroups.values()) {
      for (const rect of group) {
        result.push(placeRectangleNearOriginalPosition(rect, shelves, normalizedOptions));
      }
    }
  } else {
    for (const rect of sortedRects) {
      result.push(placeRectangleNearOriginalPosition(rect, shelves, normalizedOptions));
    }
  }
  
  if (normalizedOptions.paddingBorderX || normalizedOptions.paddingBorderY) {
    for (const rect of result) {
      rect.left += normalizedOptions.paddingBorderX;
      rect.top += normalizedOptions.paddingBorderY;
    }
  }

  const actualBounds = calculateBounds(result, normalizedOptions.paddingBorderX, normalizedOptions.paddingBorderY);

  return {
    rectangles: result,
    suggestedContainerWidth: Math.max(normalizedOptions.containerWidth, actualBounds.width),
    suggestedContainerHeight: Math.max(normalizedOptions.containerHeight, actualBounds.height),
    actualBounds
  };
}


// #endregion