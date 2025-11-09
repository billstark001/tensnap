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

interface FreeRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

// #endregion

// #region MaxRects Algorithm

class MaxRectsPacker {
  private freeRectangles: FreeRectangle[] = [];
  private usedRectangles: PlacedRectangle[] = [];

  constructor(
    maxWidth: number,
    maxHeight: number,
    private padding: number,
    private inPlace: boolean
  ) {
    this.freeRectangles.push({
      x: 0,
      y: 0,
      width: maxWidth,
      height: maxHeight
    });
  }

  insert(rect: Rectangle): PlacedRectangle | null {
    const paddedWidth = rect.width + this.padding;
    const paddedHeight = rect.height + this.padding;

    let bestNode: FreeRectangle | null = null;
    let bestScore = Infinity;

    // 尝试找到最佳位置 (Best Short Side Fit)
    for (const freeRect of this.freeRectangles) {
      if (freeRect.width >= paddedWidth && freeRect.height >= paddedHeight) {
        const leftoverHoriz = freeRect.width - paddedWidth;
        const leftoverVert = freeRect.height - paddedHeight;
        const shortSideFit = Math.min(leftoverHoriz, leftoverVert);
        const longSideFit = Math.max(leftoverHoriz, leftoverVert);

        // 优先选择短边剩余最小的，其次是长边剩余最小的
        // 同时优先选择左上角的位置
        const score = shortSideFit * 1000000 + longSideFit * 1000 + freeRect.y * 10 + freeRect.x * 0.1;

        if (score < bestScore) {
          bestScore = score;
          bestNode = freeRect;
        }
      }
    }

    if (!bestNode) {
      return null;
    }

    const placed = this.createPlaced(rect, bestNode.x, bestNode.y);
    this.usedRectangles.push(placed);

    // 使用Guillotine分割方法替代原来的分割
    this.splitFreeNodeGuillotine(bestNode, paddedWidth, paddedHeight, placed);
    this.pruneFreeList();

    return placed;
  }

  insertNearPosition(rect: PlacedRectangle, preferredX: number, preferredY: number): PlacedRectangle | null {
    const paddedWidth = rect.width + this.padding;
    const paddedHeight = rect.height + this.padding;

    let bestNode: FreeRectangle | null = null;
    let bestDistance = Infinity;

    // 找到最接近原始位置的可用空间
    for (const freeRect of this.freeRectangles) {
      if (freeRect.width >= paddedWidth && freeRect.height >= paddedHeight) {
        // 计算到原始位置的距离
        const distance = Math.sqrt(
          Math.pow(freeRect.x - preferredX, 2) + Math.pow(freeRect.y - preferredY, 2)
        );

        // 优先选择距离最近的，距离相同时优先左上角
        const score = distance * 1000000 + freeRect.y * 10 + freeRect.x * 0.1;

        if (score < bestDistance) {
          bestDistance = score;
          bestNode = freeRect;
        }
      }
    }

    if (!bestNode) {
      return null;
    }

    const placed = this.createPlaced(rect, bestNode.x, bestNode.y);
    this.usedRectangles.push(placed);

    this.splitFreeNodeGuillotine(bestNode, paddedWidth, paddedHeight, placed);
    this.pruneFreeList();

    return placed;
  }

  private splitFreeNodeGuillotine(freeNode: FreeRectangle, usedWidth: number, usedHeight: number, placed: PlacedRectangle): void {
    // 移除已使用的节点
    const index = this.freeRectangles.indexOf(freeNode);
    if (index !== -1) {
      this.freeRectangles.splice(index, 1);
    }

    // 使用Guillotine分割方法：对所有现有的空闲矩形进行分割
    // 这样可以更好地处理矩形的放置，避免重叠
    const newFreeRects: FreeRectangle[] = [];

    // 对每个空闲矩形检查是否与新放置的矩形相交
    for (const freeRect of [...this.freeRectangles]) {
      if (this.intersects(freeRect, placed, usedWidth, usedHeight)) {
        // 如果相交，将其分割成最多4个不相交的矩形
        const splits = this.splitRectByIntersection(freeRect, placed, usedWidth, usedHeight);
        newFreeRects.push(...splits);
        
        // 从原列表中移除这个矩形
        const idx = this.freeRectangles.indexOf(freeRect);
        if (idx !== -1) {
          this.freeRectangles.splice(idx, 1);
        }
      }
    }

    // 添加新分割的矩形
    this.freeRectangles.push(...newFreeRects);

    // 添加原节点的剩余空间
    // 右侧剩余空间
    if (freeNode.width > usedWidth) {
      this.freeRectangles.push({
        x: freeNode.x + usedWidth,
        y: freeNode.y,
        width: freeNode.width - usedWidth,
        height: usedHeight
      });
    }

    // 下方剩余空间
    if (freeNode.height > usedHeight) {
      this.freeRectangles.push({
        x: freeNode.x,
        y: freeNode.y + usedHeight,
        width: freeNode.width,
        height: freeNode.height - usedHeight
      });
    }
  }

  private intersects(rect: FreeRectangle, placed: PlacedRectangle, placedPaddedWidth: number, placedPaddedHeight: number): boolean {
    return !(
      rect.x >= placed.left + placedPaddedWidth ||
      rect.x + rect.width <= placed.left ||
      rect.y >= placed.top + placedPaddedHeight ||
      rect.y + rect.height <= placed.top
    );
  }

  private splitRectByIntersection(rect: FreeRectangle, placed: PlacedRectangle, placedPaddedWidth: number, placedPaddedHeight: number): FreeRectangle[] {
    const result: FreeRectangle[] = [];

    // 左侧剩余
    if (rect.x < placed.left) {
      result.push({
        x: rect.x,
        y: rect.y,
        width: Math.min(rect.width, placed.left - rect.x),
        height: rect.height
      });
    }

    // 右侧剩余
    if (rect.x + rect.width > placed.left + placedPaddedWidth) {
      result.push({
        x: Math.max(rect.x, placed.left + placedPaddedWidth),
        y: rect.y,
        width: (rect.x + rect.width) - Math.max(rect.x, placed.left + placedPaddedWidth),
        height: rect.height
      });
    }

    // 上方剩余
    if (rect.y < placed.top) {
      result.push({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: Math.min(rect.height, placed.top - rect.y)
      });
    }

    // 下方剩余
    if (rect.y + rect.height > placed.top + placedPaddedHeight) {
      result.push({
        x: rect.x,
        y: Math.max(rect.y, placed.top + placedPaddedHeight),
        width: rect.width,
        height: (rect.y + rect.height) - Math.max(rect.y, placed.top + placedPaddedHeight)
      });
    }

    return result.filter(r => r.width > 0 && r.height > 0);
  }

  private pruneFreeList(): void {
    // 移除被其他矩形完全包含的空闲矩形
    for (let i = 0; i < this.freeRectangles.length; i++) {
      for (let j = i + 1; j < this.freeRectangles.length; ) {
        if (this.isContainedIn(this.freeRectangles[i], this.freeRectangles[j])) {
          this.freeRectangles.splice(i, 1);
          i--;
          break;
        }
        if (this.isContainedIn(this.freeRectangles[j], this.freeRectangles[i])) {
          this.freeRectangles.splice(j, 1);
        } else {
          j++;
        }
      }
    }
  }

  private isContainedIn(a: FreeRectangle, b: FreeRectangle): boolean {
    return (
      a.x >= b.x &&
      a.y >= b.y &&
      a.x + a.width <= b.x + b.width &&
      a.y + a.height <= b.y + b.height
    );
  }

  private createPlaced(rect: Rectangle, left: number, top: number): PlacedRectangle {
    if (this.inPlace) {
      const placed = rect as PlacedRectangle;
      placed.left = left;
      placed.top = top;
      return placed;
    }
    return { ...rect, left, top };
  }

  getPlacedRectangles(): PlacedRectangle[] {
    return this.usedRectangles;
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

  const totalArea = rectangles.reduce((sum, r) => sum + (r.width + padding) * (r.height + padding), 0) * 1.2;
  const height = targetAspectRatio ? Math.ceil(Math.sqrt(totalArea / targetAspectRatio)) : 60;
  const width = targetAspectRatio ? Math.ceil(height * targetAspectRatio) : 80;

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

function sortRectangles(rects: Rectangle[], sortBy: 'area' | 'position', groupByType: boolean, padding: number): Rectangle[] {
  let sorted = [...rects];

  if (sortBy === 'area') {
    // 按面积降序排列，面积相同时优先放置正方形（比例接近1的）
    // 为了保证稳定性，添加索引作为最后的排序依据
    const indexed = sorted.map((rect, idx) => ({ rect, idx }));
    
    indexed.sort((a, b) => {
      const areaA = a.rect.width * a.rect.height;
      const areaB = b.rect.width * b.rect.height;
      if (areaA !== areaB) return areaB - areaA;
      
      const ratioA = Math.min(a.rect.width, a.rect.height) / Math.max(a.rect.width, a.rect.height);
      const ratioB = Math.min(b.rect.width, b.rect.height) / Math.max(b.rect.width, b.rect.height);
      if (Math.abs(ratioA - ratioB) > 0.001) return ratioB - ratioA;
      
      // 如果groupByType，按类型排序
      if (groupByType) {
        const typeCompare = a.rect.type.localeCompare(b.rect.type);
        if (typeCompare !== 0) return typeCompare;
      }
      
      // 保持原始顺序以确保稳定性
      return a.idx - b.idx;
    });
    
    sorted = indexed.map(item => item.rect);
  } else {
    // 按位置排序，添加索引保证稳定性
    const indexed = sorted.map((rect, idx) => ({ rect, idx }));
    
    indexed.sort((a, b) => {
      const topA = (a.rect as PlacedRectangle).top ?? 0;
      const topB = (b.rect as PlacedRectangle).top ?? 0;
      const deltaY = Math.abs(topA - topB);

      if (deltaY < padding) {
        const leftA = (a.rect as PlacedRectangle).left ?? 0;
        const leftB = (b.rect as PlacedRectangle).left ?? 0;
        if (Math.abs(leftA - leftB) < 0.001) return a.idx - b.idx;
        return leftA - leftB;
      }
      if (Math.abs(topA - topB) < 0.001) return a.idx - b.idx;
      return topA - topB;
    });
    
    sorted = indexed.map(item => item.rect);
  }

  return sorted;
}

function packWithMaxRects(
  rectangles: Rectangle[],
  options: NormalizedOptions,
  sortBy: 'area' | 'position',
  preservePosition: boolean
): { placed: PlacedRectangle[]; actualWidth: number; actualHeight: number } {
  const sorted = sortRectangles(rectangles, sortBy, options.groupByType, options.padding);
  const usePositionAware = preservePosition && sortBy === 'position';

  // 动态调整容器大小的策略
  let containerWidth = options.containerWidth - options.paddingBorderX * 2;
  let containerHeight = options.containerHeight - options.paddingBorderY * 2;
  let packer: MaxRectsPacker;
  let allPlaced = false;
  let attempts = 0;
  const maxAttempts = 10;

  while (!allPlaced && attempts < maxAttempts) {
    packer = new MaxRectsPacker(containerWidth, containerHeight, options.padding, options.inPlace);
    allPlaced = true;

    if (usePositionAware && options.groupByType) {
      const groups = new Map<string, PlacedRectangle[]>();
      for (const rect of sorted) {
        const group = groups.get(rect.type) || [];
        group.push(rect as PlacedRectangle);
        groups.set(rect.type, group);
      }

      for (const group of Array.from(groups.values())) {
        for (const rect of group) {
          const placed = packer.insertNearPosition(rect, rect.left ?? 0, rect.top ?? 0);
          if (!placed) {
            allPlaced = false;
            break;
          }
        }
        if (!allPlaced) break;
      }
    } else {
      for (const rect of sorted) {
        const placed = usePositionAware
          ? packer.insertNearPosition(rect as PlacedRectangle, (rect as PlacedRectangle).left ?? 0, (rect as PlacedRectangle).top ?? 0)
          : packer.insert(rect);

        if (!placed) {
          allPlaced = false;
          break;
        }
      }
    }

    if (!allPlaced) {
      // 增加容器尺寸
      attempts++;
      if (options.targetAspectRatio) {
        containerHeight = Math.ceil(containerHeight * 1.2);
        containerWidth = Math.ceil(containerHeight * options.targetAspectRatio);
      } else {
        containerWidth = Math.ceil(containerWidth * 1.2);
        containerHeight = Math.ceil(containerHeight * 1.2);
      }
    }
  }

  const placedRects = packer!.getPlacedRectangles();
  const bounds = calculateBounds(placedRects, 0, 0);

  return {
    placed: placedRects,
    actualWidth: bounds.width,
    actualHeight: bounds.height
  };
}

// #endregion

// #region Main Packing Algorithm

export function pack(rectangles: Rectangle[], rawOptions: PackingOptions = {}): PackingResult {
  if (rectangles.length === 0) {
    return {
      rectangles: [],
      suggestedContainerWidth: rawOptions.containerWidth || 80,
      suggestedContainerHeight: rawOptions.containerHeight || 60,
      actualBounds: { width: 0, height: 0 }
    };
  }

  const options = normalizeOptions(rectangles, rawOptions);
  const sortBy = options.sortBy || 'area';
  const preservePosition = options.preservePosition ?? (sortBy === 'position');
  
  // 创建副本以避免修改原数据（除非 inPlace 模式）
  const processedRects = options.inPlace ? rectangles : rectangles.map(r => ({ ...r }));

  // 在 preservePosition 模式下，先移除已有的 paddingBorder 偏移
  if (preservePosition && (options.paddingBorderX || options.paddingBorderY)) {
    for (const rect of processedRects) {
      if (rect.left !== undefined) {
        rect.left = Math.max(0, rect.left - options.paddingBorderX);
      }
      if (rect.top !== undefined) {
        rect.top = Math.max(0, rect.top - options.paddingBorderY);
      }
    }
  }

  const { placed } = packWithMaxRects(
    processedRects,
    options,
    sortBy,
    preservePosition
  );

  // 应用 paddingBorder 偏移
  if (options.paddingBorderX || options.paddingBorderY) {
    for (const rect of placed) {
      rect.left += options.paddingBorderX;
      rect.top += options.paddingBorderY;
    }
  }

  const actualBounds = calculateBounds(
    placed,
    options.paddingBorderX,
    options.paddingBorderY
  );

  return {
    rectangles: placed,
    suggestedContainerWidth: Math.ceil(Math.max(
      options.containerWidth,
      actualBounds.width
    )),
    suggestedContainerHeight: Math.ceil(Math.max(
      options.containerHeight,
      actualBounds.height
    )),
    actualBounds
  };
}

// #endregion