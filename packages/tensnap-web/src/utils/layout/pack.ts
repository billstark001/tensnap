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
  targetAspectRatio?: number;
  groupByType?: boolean;
  preservePosition?: boolean;
  padding?: number;
  paddingBorder?: number | [number, number];
  inPlace?: boolean;
  sortBy?: 'area' | 'position';
}

export interface PackingResult {
  rectangles: PlacedRectangle[];
  suggestedContainerWidth: number;
  suggestedContainerHeight: number;
  actualBounds: { width: number; height: number };
}

interface NormalizedOptions {
  containerWidth: number;
  containerHeight: number;
  targetAspectRatio?: number;
  groupByType: boolean;
  preservePosition: boolean;
  padding: number;
  paddingBorderX: number;
  paddingBorderY: number;
  inPlace: boolean;
  sortBy: 'area' | 'position';
}

// #endregion

// #region Shelf Class

export class Shelf {
  public x = 0;
  public height = 0;

  constructor(private maxWidth: number, public y: number) { }

  canFit(width: number, padding: number): boolean {
    return this.x + width + padding <= this.maxWidth;
  }

  place(rect: Rectangle, padding: number, inPlace: boolean): PlacedRectangle {
    const placed = this.createPlaced(rect, this.x, this.y, inPlace);
    this.x += rect.width + padding;
    this.height = Math.max(this.height, rect.height);
    return placed;
  }

  placeAtPreferredX(rect: Rectangle, preferredX: number, padding: number, inPlace: boolean): PlacedRectangle {
    const targetX = Math.max(this.x, preferredX);

    if (targetX + rect.width <= this.maxWidth) {
      const placed = this.createPlaced(rect, targetX, this.y, inPlace);
      this.x = Math.max(this.x, targetX + rect.width + padding);
      this.height = Math.max(this.height, rect.height);
      return placed;
    }

    return this.place(rect, padding, inPlace);
  }

  private createPlaced(rect: Rectangle, left: number, top: number, inPlace: boolean): PlacedRectangle {
    if (inPlace) {
      const placed = rect as PlacedRectangle;
      placed.left = left;
      placed.top = top;
      return placed;
    }
    return { ...rect, left, top };
  }
}

// #endregion

// #region Helper Functions

function calculateSuggestedDimensions(
  rectangles: Rectangle[],
  targetAspectRatio: number | undefined,
  padding: number
): { width: number; height: number } {
  if (rectangles.length === 0) return { width: 80, height: 60 };

  const totalArea = rectangles.reduce((sum, r) => sum + r.width * r.height, 0) * 1.2;
  const height = targetAspectRatio ? Math.sqrt(totalArea / targetAspectRatio) : 60;
  const width = targetAspectRatio ? height * targetAspectRatio : 80;

  const maxWidth = Math.max(...rectangles.map(r => r.width));
  const maxHeight = Math.max(...rectangles.map(r => r.height));

  return {
    width: Math.max(width, maxWidth + padding * 2),
    height: Math.max(height, maxHeight + padding * 2)
  };
}

function normalizeOptions(rectangles: Rectangle[], options: PackingOptions): NormalizedOptions {
  const suggested = calculateSuggestedDimensions(
    rectangles,
    options.targetAspectRatio,
    options.padding || 10
  );

  const [paddingBorderY = 0, paddingBorderX = 0] = Array.isArray(options.paddingBorder)
    ? options.paddingBorder
    : [options.paddingBorder || 0, options.paddingBorder || 0];

  return {
    containerWidth: options.containerWidth || suggested.width,
    containerHeight: options.containerHeight || suggested.height,
    targetAspectRatio: options.targetAspectRatio,
    groupByType: options.groupByType ?? true,
    preservePosition: options.preservePosition ?? false,
    padding: options.padding || 10,
    paddingBorderX,
    paddingBorderY,
    inPlace: options.inPlace ?? false,
    sortBy: options.sortBy || 'area',
  };
}

export function groupRectanglesByType(rectangles: Rectangle[]): Rectangle[] {
  const groups = new Map<string, Rectangle[]>();

  for (const rect of rectangles) {
    const group = groups.get(rect.type);
    if (group) {
      group.push(rect);
    } else {
      groups.set(rect.type, [rect]);
    }
  }

  return Array.from(groups.values()).flat();
}

function getNextShelfY(shelves: Shelf[], padding: number): number {
  if (shelves.length === 0) return 0;
  return Math.max(...shelves.map(s => s.y + s.height)) + padding;
}

export function calculateBounds(
  rectangles: PlacedRectangle[],
  paddingBorderX = 0,
  paddingBorderY = 0
): { width: number; height: number } {
  if (rectangles.length === 0) return { width: paddingBorderX, height: paddingBorderY };

  const maxX = Math.max(...rectangles.map(r => r.left + r.width));
  const maxY = Math.max(...rectangles.map(r => r.top + r.height));

  return { width: maxX + paddingBorderX, height: maxY + paddingBorderY };
}

// #endregion

// #region Core Packing Functions

function placeRectangle(
  rect: Rectangle,
  shelves: Shelf[],
  options: NormalizedOptions
): PlacedRectangle {
  const shelf = shelves.find(s => s.canFit(rect.width, options.padding));

  if (shelf) {
    return shelf.place(rect, options.padding, options.inPlace);
  }

  const newShelf = new Shelf(options.containerWidth, getNextShelfY(shelves, options.padding));
  shelves.push(newShelf);
  return newShelf.place(rect, options.padding, options.inPlace);
}

function placeRectangleNearOriginal(
  rect: PlacedRectangle,
  shelves: Shelf[],
  options: NormalizedOptions
): PlacedRectangle {
  let bestShelf: Shelf | null = null;
  let minDistance = Infinity;

  for (const shelf of shelves) {
    if (shelf.canFit(rect.width, options.padding)) {
      const distance = Math.abs(shelf.y - rect.top);
      if (distance < minDistance) {
        minDistance = distance;
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

function sortRectangles(rects: Rectangle[], sortBy: 'area' | 'position', groupByType: boolean, padding: number): Rectangle[] {
  let sorted = rects;

  if (sortBy === 'area') {
    if (groupByType) sorted = groupRectanglesByType(sorted);
    sorted.sort((a, b) => b.width * b.height - a.width * a.height);
  } else {
    sorted.sort((a, b) => {
      const topA = (a as PlacedRectangle).top ?? 0;
      const topB = (b as PlacedRectangle).top ?? 0;
      const deltaY = Math.abs(topA - topB);

      if (deltaY < padding) {
        return ((a as PlacedRectangle).left ?? 0) - ((b as PlacedRectangle).left ?? 0);
      }
      return topA - topB;
    });
  }

  return sorted;
}

function packWithStrategy(
  rectangles: Rectangle[],
  options: NormalizedOptions,
  sortBy: 'area' | 'position',
  preservePosition: boolean
): PlacedRectangle[] {
  const shelves: Shelf[] = [];
  const sorted = sortRectangles(rectangles, sortBy, options.groupByType, options.padding);
  const usePositionAware = preservePosition && sortBy === 'position';

  if (usePositionAware && options.groupByType) {
    const groups = new Map<string, PlacedRectangle[]>();
    for (const rect of sorted) {
      const group = groups.get(rect.type) || [];
      group.push(rect as PlacedRectangle);
      groups.set(rect.type, group);
    }

    return Array.from(groups.values())
      .flat()
      .map(r => placeRectangleNearOriginal(r, shelves, options));
  }

  return sorted.map(rect =>
    usePositionAware
      ? placeRectangleNearOriginal(rect as PlacedRectangle, shelves, options)
      : placeRectangle(rect, shelves, options)
  );
}

// #endregion

// #region Main Packing Algorithm

export function pack(rectangles: Rectangle[], rawOptions: PackingOptions = {}): PackingResult {
  const options = normalizeOptions(rectangles, rawOptions);
  const sortBy = options.sortBy || 'area';
  const preservePosition = options.preservePosition ?? (sortBy === 'position');
  const processedRects = options.inPlace ? rectangles : [...rectangles];

  const result = packWithStrategy(processedRects, options, sortBy, preservePosition);

  if (options.paddingBorderX || options.paddingBorderY) {
    for (const rect of result) {
      rect.left += options.paddingBorderX;
      rect.top += options.paddingBorderY;
    }
  }

  const actualBounds = calculateBounds(
    result,
    options.paddingBorderX,
    options.paddingBorderY
  );

  return {
    rectangles: result,
    suggestedContainerWidth: Math.max(options.containerWidth, actualBounds.width),
    suggestedContainerHeight: Math.max(options.containerHeight, actualBounds.height),
    actualBounds
  };
}

// #endregion