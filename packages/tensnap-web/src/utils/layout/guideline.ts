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
  | 'cross';

export type GuideLine = {
  type: 'horizontal' | 'vertical';
  position: number;
  alignType: AlignType;
  relatedSegments: GuideLineSegment[];
};

type Boundary = {
  pos: number;
  viewIndex: number;
  type: string;
};

type Axis = 'horizontal' | 'vertical';

/**
 * Core guideline generator with caching and incremental updates
 */
export class GuideLineGenerator {
  private viewsHash = '';
  private boundaries: Record<Axis, Boundary[]> = { horizontal: [], vertical: [] };
  private readonly threshold: number;
  private readonly extension = 20;

  // Axis configuration for cleaner iteration
  private readonly axisConfig = {
    vertical: {
      points: ['left', 'right', 'centerX'] as const,
      alignTypes: ['edge-left', 'edge-right', 'center-v'] as const,
      viewKeys: ['left', 'right', 'center'] as const,
      dimProp: 'width' as const,
      posProp: 'left' as const,
    },
    horizontal: {
      points: ['top', 'bottom', 'centerY'] as const,
      alignTypes: ['edge-top', 'edge-bottom', 'center-h'] as const,
      viewKeys: ['top', 'bottom', 'center'] as const,
      dimProp: 'height' as const,
      posProp: 'top' as const,
    },
  };

  constructor(threshold = 5) {
    this.threshold = threshold;
  }

  generate(snapContent: GuideLineContent, viewsUpdated: boolean | 'auto' = 'auto'): GuideLine[] {
    const { coord, views } = snapContent;
    if (viewsUpdated === false) {
      return this.getGuidelinesForCoord(coord);
    }
    const newHash = this.hashViews(views);
    if (viewsUpdated === true || newHash !== this.viewsHash) {
      this.buildSpatialIndex(views);
      this.viewsHash = newHash;
    }
    return this.getGuidelinesForCoord(coord);
  }

  private getGuidelinesForCoord(coord: ViewBox): GuideLine[] {
    const guidelines: GuideLine[] = [];
    const points = this.extractKeyPoints(coord);

    (['vertical', 'horizontal'] as Axis[]).forEach(axis => {
      this.matchGuidelines(axis, points, coord, guidelines);
    });

    return this.deduplicateGuidelines(guidelines);
  }

  private matchGuidelines(
    axis: Axis,
    points: ReturnType<typeof this.extractKeyPoints>,
    coord: ViewBox,
    guidelines: GuideLine[]
  ): void {
    const config = this.axisConfig[axis];
    const boundaries = this.boundaries[axis];

    config.points.forEach((point, i) => {
      const matches = this.findMatchingBoundaries(boundaries, points[point], this.threshold);

      matches.forEach(match => {
        const segments = this.calculateSegments(axis, match.viewIndex, coord);
        if (segments.length > 0) {
          guidelines.push({
            type: axis,
            position: match.pos,
            alignType: config.alignTypes[i],
            relatedSegments: segments,
          });
        }
      });
    });
  }

  private calculateSegments(axis: Axis, viewIndex: number, coord: ViewBox): GuideLineSegment[] {
    // Get perpendicular axis for overlap calculation
    const perpAxis = axis === 'vertical' ? 'horizontal' : 'vertical';
    const config = this.axisConfig[perpAxis];

    const viewBounds = this.boundaries[perpAxis].filter(b => b.viewIndex === viewIndex);
    if (viewBounds.length === 0) return [];

    const viewStart = viewBounds.find(b => b.type === config.viewKeys[0])?.pos ?? 0;
    const viewEnd = viewBounds.find(b => b.type === config.viewKeys[1])?.pos ?? 0;

    const coordStart = coord[config.posProp];
    const coordEnd = coordStart + coord[config.dimProp];

    const overlapStart = Math.max(viewStart, coordStart);
    const overlapEnd = Math.min(viewEnd, coordEnd);

    if (overlapStart < overlapEnd) {
      return [{ start: overlapStart, end: overlapEnd }];
    }

    return [{
      start: Math.min(viewStart, coordStart) - this.extension,
      end: Math.max(viewEnd, coordEnd) + this.extension,
    }];
  }

  private findMatchingBoundaries(
    boundaries: Boundary[],
    target: number,
    threshold: number
  ): Boundary[] {
    const [minPos, maxPos] = [target - threshold, target + threshold];

    // Binary search for lower bound
    let left = 0, right = boundaries.length;
    while (left < right) {
      const mid = (left + right) >> 1;
      if (boundaries[mid].pos < minPos) left = mid + 1;
      else right = mid;
    }

    // Collect matches in range
    const matches: Boundary[] = [];
    for (let i = left; i < boundaries.length && boundaries[i].pos <= maxPos; i++) {
      matches.push(boundaries[i]);
    }
    return matches;
  }

  private buildSpatialIndex(views: ViewBox[]): void {
    const horizontal: Boundary[] = [];
    const vertical: Boundary[] = [];

    views.forEach((view, index) => {
      // Horizontal boundaries (Y-axis)
      horizontal.push(
        { pos: view.top, viewIndex: index, type: 'top' },
        { pos: view.top + view.height, viewIndex: index, type: 'bottom' },
        { pos: view.top + view.height / 2, viewIndex: index, type: 'center' }
      );

      // Vertical boundaries (X-axis)
      vertical.push(
        { pos: view.left, viewIndex: index, type: 'left' },
        { pos: view.left + view.width, viewIndex: index, type: 'right' },
        { pos: view.left + view.width / 2, viewIndex: index, type: 'center' }
      );
    });

    horizontal.sort((a, b) => a.pos - b.pos);
    vertical.sort((a, b) => a.pos - b.pos);

    this.boundaries = { horizontal, vertical };
  }

  private extractKeyPoints(box: ViewBox) {
    return {
      left: box.left,
      right: box.left + box.width,
      centerX: box.left + box.width / 2,
      top: box.top,
      bottom: box.top + box.height,
      centerY: box.top + box.height / 2,
    };
  }

  private deduplicateGuidelines(guidelines: GuideLine[]): GuideLine[] {
    const map = new Map<string, GuideLine>();

    guidelines.forEach(line => {
      const key = `${line.type}-${Math.round(line.position)}-${line.alignType}`;
      const existing = map.get(key);

      if (existing) {
        existing.relatedSegments.push(...line.relatedSegments);
      } else {
        map.set(key, { ...line });
      }
    });

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
      const current = sorted[i];

      if (current.start <= last.end) {
        last.end = Math.max(last.end, current.end);
      } else {
        merged.push(current);
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
  if (alignType.includes('right') || alignType === 'edge-bottom') {
    return snapPos - dimension;
  }
  if (alignType.includes('center')) {
    return snapPos - dimension / 2;
  }
  return snapPos; // edge-left or edge-top
}

export function calculateSnapDistance(coord: ViewBox, line: GuideLine): number {
  switch (line.alignType) {
    case 'edge-left':
      return Math.abs(coord.left - line.position);
    case 'edge-right':
      return Math.abs(coord.left + coord.width - line.position);
    case 'center-v':
      return Math.abs(coord.left + coord.width / 2 - line.position);
    case 'edge-top':
      return Math.abs(coord.top - line.position);
    case 'edge-bottom':
      return Math.abs(coord.top + coord.height - line.position);
    case 'center-h':
      return Math.abs(coord.top + coord.height / 2 - line.position);
    case 'cross':
    default:
      return Infinity;
  }
}

/**
 * Fast guideline matcher for real-time snapping
 */
export class GuideLineMatcher {
  private generator: GuideLineGenerator;
  private snapContent: GuideLineContent;
  private viewsUpdated = false;

  constructor(snapContent: GuideLineContent, threshold = 5) {
    this.generator = new GuideLineGenerator(threshold);
    this.snapContent = snapContent;
    this.viewsUpdated = true;
  }

  updateViews(views: ViewBox[]): void {
    this.snapContent.views = views;
    this.viewsUpdated = true;
  }

  match(coord: ViewBox): {
    guidelines: GuideLine[];
    snapX: number | null;
    snapY: number | null;
  } {
    const guidelines = this.generator.generate({ ...this.snapContent, coord }, this.viewsUpdated);
    this.viewsUpdated = false;

    const snap = { snapX: null as number | null, snapY: null as number | null };
    let [minDistX, minDistY] = [Infinity, Infinity];

    guidelines.forEach(line => {
      const dist = calculateSnapDistance(coord, line);

      if (line.type === 'vertical' && dist < minDistX) {
        minDistX = dist;
        snap.snapX = calcSnapPos(line.position, coord.width, line.alignType);
      } else if (line.type === 'horizontal' && dist < minDistY) {
        minDistY = dist;
        snap.snapY = calcSnapPos(line.position, coord.height, line.alignType);
      }
    });

    return { guidelines, ...snap };
  }

}