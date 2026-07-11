import { Line } from '@leafer-ui/core';
import { BaseLayer } from './BaseLayer';
import type { EnvironmentViewFitMode } from '../host';
import {
  TrajectoryDelta,
  TrajectoryAppendDelta,
  TrajectoryEntry,
  TrajectoryStorage,
  TrajectoryStorageData,
} from '../storages/TrajectoryStorage';
import { AgentId, GridCoordOffset, Viewport } from '../types';
import { getCoordOffsetValue } from '../utils';
import { splitTrajectoryPoints, TrajectoryWorldBounds } from '../utils/trajectory';

const TRAJECTORY_CHUNK_POINTS = 1_024;

export interface TrajectoryLayerConfig {
  coordOffset?: GridCoordOffset;
  worldBounds?: TrajectoryWorldBounds;
}

interface TrajectorySegmentCache {
  lines: Line[];
  pointChunks: number[][];
}

interface TrajectoryLineCacheEntry {
  segments: TrajectorySegmentCache[];
  color: string;
  width: number;
}

export class TrajectoryLayer extends BaseLayer {
  readonly defaultZIndex = 30;

  private readonly _cfg: TrajectoryLayerConfig;
  private readonly _lines = new Map<AgentId, TrajectoryLineCacheEntry>();

  constructor(
    storage: TrajectoryStorage,
    config: TrajectoryLayerConfig = {},
  ) {
    super();
    this._cfg = {
      coordOffset: 'int',
      worldBounds: undefined,
      ...config,
    };

    this.registerStorage(storage, (data, delta) => this._onTrajectoryData(data, delta));
    this._onTrajectoryData(storage.getData(), { replaced: true });
  }

  // #region Viewport

  onViewportChange(viewport: Viewport, fitMode: EnvironmentViewFitMode): void {
    this.applyViewportTransform(viewport, fitMode);
    this._updateStrokeWidths();
  }

  // #endregion

  // #region Rendering

  private get _posOffset(): number {
    return getCoordOffsetValue(this._cfg.coordOffset);
  }

  private _toSceneStroke(width: number): number {
    const scale = this.calculateViewportScale(this._viewport, this._fitMode);
    const avg = (Math.abs(scale.scaleX) + Math.abs(scale.scaleY)) / 2;
    return Math.max(0.1, width / avg);
  }

  private _onTrajectoryData(
    data: TrajectoryStorageData,
    delta: TrajectoryDelta = { replaced: true },
  ): void {
    if (delta.replaced) {
      this._clearLines();
      for (const [id, entry] of data.trajectories.entries()) {
        this._upsertLine(id, entry);
      }
      return;
    }

    for (const id of delta.deleted) {
      this._removeLine(id);
    }

    const incrementallyApplied = new Set<AgentId>();
    for (const append of delta.appendDeltas ?? []) {
      const entry = data.trajectories.get(append.id);
      if (entry && this._appendTail(append.id, entry, append)) {
        incrementallyApplied.add(append.id);
      }
    }

    const idsToRefresh = new Set<AgentId>([
      ...delta.created.filter((id) => !incrementallyApplied.has(id)),
      ...delta.updated.filter((id) => !incrementallyApplied.has(id)),
      ...delta.appended.filter((id) => !incrementallyApplied.has(id)),
    ]);

    for (const id of idsToRefresh) {
      const entry = data.trajectories.get(id);
      if (!entry) {
        this._removeLine(id);
        continue;
      }
      this._upsertLine(id, entry);
    }
  }

  private _upsertLine(id: AgentId, entry: TrajectoryEntry): void {
    // A retained deletion closes the current path.  Preserve that logical
    // boundary in addition to any world-wrap boundaries so an id reuse never
    // draws a line from its old location to its new one.
    const { segments, firstPointColor } = this._collectRenderableSegments(entry);

    if (segments.length === 0) {
      this._removeLine(id);
      return;
    }

    const color = firstPointColor ?? entry.defaultColor;
    const strokeWidth = this._toSceneStroke(entry.width);

    this._removeLine(id);
    const cached: TrajectoryLineCacheEntry = { segments: [], color, width: entry.width };
    this._lines.set(id, cached);

    for (const segment of segments) this._appendSegment(cached, segment, strokeWidth);
  }

  /**
   * Append only to the active chunk. Ring wrap, segment closure and world-wrap
   * splitting change earlier geometry, so those intentionally fall back to a
   * local full rebuild of this trajectory.
   */
  private _appendTail(
    id: AgentId,
    entry: TrajectoryEntry,
    append: TrajectoryAppendDelta,
  ): boolean {
    if (this._cfg.worldBounds) return false;
    const cached = this._lines.get(id);
    if (!cached) return false;
    const strokeWidth = this._toSceneStroke(entry.width);
    if (append.evicted) {
      if (cached.segments.length !== entry.segments.length) return false;
      this._rebuildActiveSegment(cached, entry, strokeWidth);
      cached.width = entry.width;
      return true;
    }
    if (append.startedSegment) {
      if (cached.segments.length + 1 !== entry.segments.length) return false;
      this._appendSegment(cached, [append.point], strokeWidth);
      cached.width = entry.width;
      return true;
    }
    if (cached.segments.length !== entry.segments.length) return false;
    const segment = cached.segments[cached.segments.length - 1];
    if (!segment) return false;

    let chunk = segment.pointChunks[segment.pointChunks.length - 1];
    let line = segment.lines[segment.lines.length - 1];
    if (!chunk || !line || chunk.length / 2 >= TRAJECTORY_CHUNK_POINTS) {
      chunk = [];
      line = new Line({ stroke: cached.color, strokeWidth, points: chunk });
      this.group.add(line);
      segment.pointChunks.push(chunk);
      segment.lines.push(line);
    }
    chunk.push(append.point.x + this._posOffset, append.point.y + this._posOffset);
    line.set({ points: chunk, strokeWidth });
    cached.width = entry.width;
    return true;
  }

  private _appendSegment(
    cached: TrajectoryLineCacheEntry,
    points: Array<{ x: number; y: number }>,
    strokeWidth: number,
  ): void {
    const segmentCache: TrajectorySegmentCache = { lines: [], pointChunks: [] };
    for (let start = 0; start < points.length; start += TRAJECTORY_CHUNK_POINTS) {
      const chunk = this._flattenPoints(points.slice(start, start + TRAJECTORY_CHUNK_POINTS));
      const line = new Line({ stroke: cached.color, strokeWidth, points: chunk });
      this.group.add(line);
      segmentCache.lines.push(line);
      segmentCache.pointChunks.push(chunk);
    }
    cached.segments.push(segmentCache);
  }

  private _rebuildActiveSegment(
    cached: TrajectoryLineCacheEntry,
    entry: TrajectoryEntry,
    strokeWidth: number,
  ): void {
    const previous = cached.segments.pop();
    for (const line of previous?.lines ?? []) line.remove();
    this._appendSegment(cached, entry.ring.toArray(), strokeWidth);
  }

  private _flattenPoints(points: Array<{ x: number; y: number }>): number[] {
    const flatPoints = new Array<number>(points.length * 2);
    for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
      flatPoints[pointIndex * 2] = points[pointIndex].x + this._posOffset;
      flatPoints[pointIndex * 2 + 1] = points[pointIndex].y + this._posOffset;
    }
    return flatPoints;
  }

  /**
   * Materialize each ring at most once per render. The previous implementation
   * flattened every point once for color resolution and again for splitting,
   * doubling hot-path allocations as trails grow.
   */
  private _collectRenderableSegments(entry: TrajectoryEntry): {
    segments: ReturnType<typeof splitTrajectoryPoints>;
    firstPointColor: string | undefined;
  } {
    const segments: ReturnType<typeof splitTrajectoryPoints> = [];
    let firstPointColor: string | undefined;
    for (const ring of entry.segments) {
      const points = ring.toArray();
      if (firstPointColor === undefined) {
        firstPointColor = points.find((point) => (
          typeof point.color === 'string' && point.color.length > 0
        ))?.color;
      }
      segments.push(...splitTrajectoryPoints(points, this._cfg.worldBounds));
    }
    return { segments, firstPointColor };
  }

  private _updateStrokeWidths(): void {
    for (const cached of this._lines.values()) {
      const strokeWidth = this._toSceneStroke(cached.width);
      for (const segment of cached.segments) {
        for (const line of segment.lines) line.set({ strokeWidth });
      }
    }
  }

  private _removeLine(id: AgentId): void {
    const cached = this._lines.get(id);
    if (!cached) {
      return;
    }
    for (const segment of cached.segments) {
      for (const line of segment.lines) line.remove();
    }
    this._lines.delete(id);
  }

  private _clearLines(): void {
    for (const cached of this._lines.values()) {
      for (const segment of cached.segments) {
        for (const line of segment.lines) line.remove();
      }
    }
    this._lines.clear();
  }

  // #endregion

  // #region Lifecycle

  destroy(): void {
    this._clearLines();
    super.destroy();
  }

  // #endregion
}
