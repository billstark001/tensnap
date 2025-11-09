export type ViewBox = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type GuideLineContent = {
  coord: ViewBox;
  views: ViewBox[];
};

export type GuideLineSegment = {
  start: number;
  end: number;
};

export type AlignType =
  | 'edge-left'
  | 'edge-right'
  | 'edge-top'
  | 'edge-bottom'
  | 'center-h'
  | 'center-v'
  | 'spacing-h'
  | 'spacing-v'
  | 'size-h'
  | 'size-v'
  | 'cross';

export type GuideLine = {
  type: 'horizontal' | 'vertical';
  position: number;
  alignType: AlignType;
  relatedSegments: GuideLineSegment[];
  spacingInfo?: {
    distance: number;
    referenceViews: number[];
  };
};

type Boundary = {
  pos: number;
  viewIndex: number;
  type: string;
};

type Axis = 'horizontal' | 'vertical';

// 轴向配置统一定义
const AXIS_CONFIG = {
  vertical: {
    posKey: 'left' as const,
    sizeKey: 'width' as const,
    perpPosKey: 'top' as const,
    perpSizeKey: 'height' as const,
    edgeTypes: ['left', 'right', 'center'] as const,
    alignTypes: ['edge-left', 'edge-right', 'center-v'] as const,
    spacingAlign: 'spacing-h' as const,
    sizeAlign: 'size-v' as const,
  },
  horizontal: {
    posKey: 'top' as const,
    sizeKey: 'height' as const,
    perpPosKey: 'left' as const,
    perpSizeKey: 'width' as const,
    edgeTypes: ['top', 'bottom', 'center'] as const,
    alignTypes: ['edge-top', 'edge-bottom', 'center-h'] as const,
    spacingAlign: 'spacing-v' as const,
    sizeAlign: 'size-h' as const,
  },
} as const;

export class GuideLineGenerator {
  private viewsHash = '';
  private boundaries: Record<Axis, Boundary[]> = { horizontal: [], vertical: [] };
  private views: ViewBox[] = [];
  private readonly threshold: number;
  private readonly extension = 20;
  private readonly enableSpacing: boolean;
  private readonly enableSize: boolean;

  constructor(
    threshold = 5,
    options: { enableSpacing?: boolean; enableSize?: boolean } = {}
  ) {
    this.threshold = threshold;
    this.enableSpacing = options.enableSpacing ?? true;
    this.enableSize = options.enableSize ?? true;
  }

  generate(snapContent: GuideLineContent, viewsUpdated: boolean | 'auto' = 'auto'): GuideLine[] {
    const { coord, views } = snapContent;

    if (viewsUpdated === false) {
      return this.getGuidelinesForCoord(coord);
    }

    const newHash = this.hashViews(views);
    if (viewsUpdated === true || newHash !== this.viewsHash) {
      this.views = views;
      this.buildSpatialIndex(views);
      this.viewsHash = newHash;
    }

    return this.getGuidelinesForCoord(coord);
  }

  private getGuidelinesForCoord(coord: ViewBox): GuideLine[] {
    const guidelines: GuideLine[] = [];

    this.matchEdgeGuidelines('vertical', coord, guidelines);
    this.matchEdgeGuidelines('horizontal', coord, guidelines);

    // 等间距和等尺寸
    if (this.enableSpacing) {
      this.matchSpacingGuidelines('vertical', coord, guidelines);
      this.matchSpacingGuidelines('horizontal', coord, guidelines);
    }
    if (this.enableSize) {
      this.matchSizeGuidelines('width', coord, guidelines);
      this.matchSizeGuidelines('height', coord, guidelines);
    }

    return this.deduplicateGuidelines(guidelines);
  }

  private matchEdgeGuidelines(axis: Axis, coord: ViewBox, guidelines: GuideLine[]): void {
    const config = AXIS_CONFIG[axis];
    const boundaries = this.boundaries[axis];
    const points = this.getAxisPoints(coord, axis);

    for (let i = 0; i < points.length; i++) {
      const matches = this.findMatchingBoundaries(boundaries, points[i], this.threshold);

      for (const match of matches) {
        const segments = this.calculateSegments(axis, match.viewIndex, coord);
        if (segments.length > 0) {
          guidelines.push({
            type: axis,
            position: match.pos,
            alignType: config.alignTypes[i],
            relatedSegments: segments,
          });
        }
      }
    };
  }

  private matchSpacingGuidelines(axis: Axis, coord: ViewBox, guidelines: GuideLine[]): void {

    const config = AXIS_CONFIG[axis];
    const spacings = this.calculateSpacings(axis);

    for (const [{ distance, views: [v1, v2] }] of spacings) {
      // 检查 coord 能否在 v1 前或 v2 后形成等间距
      const coordEnd = coord[config.posKey] + coord[config.sizeKey];
      const v1Start = v1.view[config.posKey];
      const v2End = v2.view[config.posKey] + v2.view[config.sizeKey];

      // coord 在 v1 之前
      const distBefore = v1Start - coordEnd;
      if (Math.abs(distBefore - distance) <= this.threshold && distBefore > 0) {
        guidelines.push(this.createSpacingGuideline(
          axis,
          v1Start - distance - coord[config.sizeKey],
          distance,
          [v1.index, v2.index],
          [coord, v1.view, v2.view]
        ));
      }

      // coord 在 v2 之后
      const distAfter = coord[config.posKey] - v2End;
      if (Math.abs(distAfter - distance) <= this.threshold && distAfter > 0) {
        guidelines.push(this.createSpacingGuideline(
          axis,
          v2End + distance,
          distance,
          [v1.index, v2.index],
          [coord, v1.view, v2.view]
        ));
      }
    };

  }

  private matchSizeGuidelines(dim: 'width' | 'height', coord: ViewBox, guidelines: GuideLine[]): void {
    const axis = dim === 'width' ? 'vertical' : 'horizontal';
    const config = AXIS_CONFIG[axis];
    const sizeGroups = this.groupBySizes(dim);

    for (const { size, indices } of sizeGroups) {
      if (indices.length < 2) return;

      if (Math.abs(coord[dim] - size) <= this.threshold) {
        // 修复：size 类型的 position 应该表示尺寸本身，而非位置
        guidelines.push({
          type: axis,
          position: coord[config.posKey], // 保持当前位置不变
          alignType: config.sizeAlign,
          relatedSegments: this.createSizeSegments(axis, coord, indices.slice(0, 2)),
          spacingInfo: {
            distance: size,
            referenceViews: indices,
          },
        });
      }
    }

  }

  private calculateSpacings(axis: Axis) {
    const config = AXIS_CONFIG[axis];
    const sorted = this.views
      .map((view, index) => ({ view, index }))
      .sort((a, b) => a.view[config.posKey] - b.view[config.posKey]);

    const spacings: Array<{
      distance: number;
      views: [typeof sorted[0], typeof sorted[0]];
      gap: [number, number];
    }> = [];

    for (let i = 0; i < sorted.length - 1; i++) {
      const curr = sorted[i].view;
      const next = sorted[i + 1].view;
      const distance = next[config.posKey] - (curr[config.posKey] + curr[config.sizeKey]);

      if (distance > 0) {
        spacings.push({
          distance,
          views: [sorted[i], sorted[i + 1]],
          gap: [curr[config.posKey] + curr[config.sizeKey], next[config.posKey]],
        });
      }
    }

    // 聚合相近的间距
    return this.groupByDistance(spacings);
  }

  private groupByDistance<T extends { distance: number }>(items: T[]): T[][] {
    const groups: T[][] = [];
    for (const item of items) {
      const group = groups.find(g => Math.abs(g[0].distance - item.distance) <= this.threshold);
      if (group) {
        group.push(item);
      } else {
        groups.push([item]);
      }
    }
    return groups.filter(g => g.length >= 1).map(g => g.slice(0, 1)); // 每组取一个代表
  }

  private groupBySizes(dim: 'width' | 'height') {
    const groups: Array<{ size: number; indices: number[] }> = [];
    for (let i = 0; i < this.views.length; i++) {
      const view = this.views[i];
      const size = view[dim];
      const group = groups.find(g => Math.abs(g.size - size) <= this.threshold);
      if (group) {
        group.indices.push(i);
      } else {
        groups.push({ size, indices: [i] });
      }
    }
    return groups;
  }

  private createSpacingGuideline(
    axis: Axis,
    position: number,
    distance: number,
    refIndices: number[],
    boxes: ViewBox[]
  ): GuideLine {
    const config = AXIS_CONFIG[axis === 'vertical' ? 'horizontal' : 'vertical'];
    const starts = boxes.map(b => b[config.posKey]);
    const ends = boxes.map(b => b[config.posKey] + b[config.sizeKey]);

    return {
      type: axis,
      position,
      alignType: AXIS_CONFIG[axis].spacingAlign,
      relatedSegments: [{
        start: Math.min(...starts) - this.extension,
        end: Math.max(...ends) + this.extension,
      }],
      spacingInfo: { distance, referenceViews: refIndices },
    };
  }

  private createSizeSegments(axis: Axis, coord: ViewBox, indices: number[]): GuideLineSegment[] {
    const config = AXIS_CONFIG[axis === 'vertical' ? 'horizontal' : 'vertical'];
    const boxes = [coord, ...indices.map(i => this.views[i])];
    const starts = boxes.map(b => b[config.posKey]);
    const ends = boxes.map(b => b[config.posKey] + b[config.sizeKey]);

    return [{
      start: Math.min(...starts) - this.extension,
      end: Math.max(...ends) + this.extension,
    }];
  }

  private calculateSegments(axis: Axis, viewIndex: number, coord: ViewBox): GuideLineSegment[] {
    const perpConfig = AXIS_CONFIG[axis === 'vertical' ? 'horizontal' : 'vertical'];
    const viewBounds = this.boundaries[axis === 'vertical' ? 'horizontal' : 'vertical']
      .filter(b => b.viewIndex === viewIndex);

    if (viewBounds.length === 0) return [];

    const viewStart = viewBounds.find(b => b.type === perpConfig.edgeTypes[0])?.pos ?? 0;
    const viewEnd = viewBounds.find(b => b.type === perpConfig.edgeTypes[1])?.pos ?? 0;
    const coordStart = coord[perpConfig.posKey];
    const coordEnd = coordStart + coord[perpConfig.sizeKey];

    const overlapStart = Math.max(viewStart, coordStart);
    const overlapEnd = Math.min(viewEnd, coordEnd);

    return overlapStart < overlapEnd
      ? [{ start: overlapStart, end: overlapEnd }]
      : [{ start: Math.min(viewStart, coordStart) - this.extension, end: Math.max(viewEnd, coordEnd) + this.extension }];
  }

  private getAxisPoints(box: ViewBox, axis: Axis): [number, number, number] {
    const config = AXIS_CONFIG[axis];
    return [
      box[config.posKey],
      box[config.posKey] + box[config.sizeKey],
      box[config.posKey] + box[config.sizeKey] / 2,
    ];
  }

  private buildSpatialIndex(views: ViewBox[]): void {
    const boundaries = { horizontal: [] as Boundary[], vertical: [] as Boundary[] };
    const pushBoundary = (axis: Axis, index: number) => {
      const view = views[index];
      const config = AXIS_CONFIG[axis];
      const pos = view[config.posKey];
      const size = view[config.sizeKey];

      boundaries[axis].push(
        { pos, viewIndex: index, type: config.edgeTypes[0] },
        { pos: pos + size, viewIndex: index, type: config.edgeTypes[1] },
        { pos: pos + size / 2, viewIndex: index, type: config.edgeTypes[2] }
      );
    };

    for (let i = 0; i < views.length; i++) {
      pushBoundary('horizontal', i);
      pushBoundary('vertical', i);
    }

    boundaries.horizontal.sort((a, b) => a.pos - b.pos);
    boundaries.vertical.sort((a, b) => a.pos - b.pos);
    this.boundaries = boundaries;
  }

  private findMatchingBoundaries(boundaries: Boundary[], target: number, threshold: number): Boundary[] {
    const [min, max] = [target - threshold, target + threshold];
    let left = 0, right = boundaries.length;

    while (left < right) {
      const mid = (left + right) >> 1;
      boundaries[mid].pos < min ? (left = mid + 1) : (right = mid);
    }

    return boundaries.slice(left).filter(b => b.pos <= max);
  }

  private deduplicateGuidelines(guidelines: GuideLine[]): GuideLine[] {
    const map = new Map<string, GuideLine>();

    for (const line of guidelines) {
      const key = `${line.type}-${Math.round(line.position)}-${line.alignType}`;
      const existing = map.get(key);

      if (existing) {
        existing.relatedSegments.push(...line.relatedSegments);
      } else {
        map.set(key, { ...line });
      }
    }

    return Array.from(map.values()).map(line => ({
      ...line,
      relatedSegments: this.mergeSegments(line.relatedSegments),
    }));
  }

  private mergeSegments(segments: GuideLineSegment[]): GuideLineSegment[] {
    if (segments.length === 0) return [];

    const sorted = segments.slice().sort((a, b) => a.start - b.start);
    const merged: GuideLineSegment[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const last = merged[merged.length - 1];
      if (sorted[i].start <= last.end) {
        last.end = Math.max(last.end, sorted[i].end);
      } else {
        merged.push(sorted[i]);
      }
    }

    return merged;
  }

  private hashViews(views: ViewBox[]): string {
    return views.map(v => `${v.left},${v.top},${v.width},${v.height}`).join('|');
  }

  clearCache(): void {
    this.viewsHash = '';
    this.boundaries = { horizontal: [], vertical: [] };
  }
}

export function calcSnapPos(snapPos: number, dimension: number, alignType: AlignType): number {
  if (alignType === 'edge-right' || alignType === 'edge-bottom') return snapPos - dimension;
  if (alignType.includes('center')) return snapPos - dimension / 2;
  return snapPos;
}

export function calculateSnapDistance(coord: ViewBox, line: GuideLine): number {
  const distMap: Record<AlignType, () => number> = {
    'edge-left': () => Math.abs(coord.left - line.position),
    'edge-right': () => Math.abs(coord.left + coord.width - line.position),
    'center-v': () => Math.abs(coord.left + coord.width / 2 - line.position),
    'edge-top': () => Math.abs(coord.top - line.position),
    'edge-bottom': () => Math.abs(coord.top + coord.height - line.position),
    'center-h': () => Math.abs(coord.top + coord.height / 2 - line.position),
    'spacing-h': () => Math.abs(coord.left - line.position),
    'spacing-v': () => Math.abs(coord.top - line.position),
    'size-h': () => line.spacingInfo ? Math.abs(coord.height - line.spacingInfo.distance) : Infinity,
    'size-v': () => line.spacingInfo ? Math.abs(coord.width - line.spacingInfo.distance) : Infinity,
    'cross': () => Infinity,
  };

  return distMap[line.alignType]();
}

export class GuideLineMatcher {
  private generator: GuideLineGenerator;
  private snapContent: GuideLineContent;
  private viewsUpdated = false;
  private mode: 'drag' | 'resize';

  constructor(
    snapContent: GuideLineContent,
    threshold = 5,
    mode: 'drag' | 'resize' = 'drag',
    options?: { enableSpacing?: boolean; enableSize?: boolean }
  ) {
    this.generator = new GuideLineGenerator(threshold, options);
    this.snapContent = snapContent;
    this.viewsUpdated = true;
    this.mode = mode;
  }

  updateViews(views: ViewBox[]): void {
    this.snapContent.views = views;
    this.viewsUpdated = true;
  }

  match(coord: ViewBox) {
    const guidelines = this.generator.generate({ ...this.snapContent, coord }, this.viewsUpdated);
    this.viewsUpdated = false;

    const snap: {
      snapX?: number;
      snapY?: number;
      snapWidth?: number;
      snapHeight?: number;
    } = {};
    let [minX, minY, minW, minH] = [Infinity, Infinity, Infinity, Infinity];

    for (const line of guidelines) {
      const dist = calculateSnapDistance(coord, line);
      const isResize = this.mode === 'resize';

      if (line.type === 'vertical') {
        if (line.alignType === 'size-v' && dist < minW) {
          minW = dist;
          snap.snapWidth = line.spacingInfo!.distance;
        } else if (line.alignType === 'edge-right' && isResize && dist < minX) {
          minX = dist;
          snap.snapX = line.position - coord.left;
        } else if (!isResize && !line.alignType.startsWith('size') && dist < minX) {
          minX = dist;
          snap.snapX = calcSnapPos(line.position, coord.width, line.alignType);
        }
      } else {
        if (line.alignType === 'size-h' && dist < minH) {
          minH = dist;
          snap.snapHeight = line.spacingInfo!.distance;
        } else if (line.alignType === 'edge-bottom' && isResize && dist < minY) {
          minY = dist;
          snap.snapY = line.position - coord.top;
        } else if (!isResize && !line.alignType.startsWith('size') && dist < minY) {
          minY = dist;
          snap.snapY = calcSnapPos(line.position, coord.height, line.alignType);
        }
      }
    }

    return { guidelines, ...snap };
  }
}