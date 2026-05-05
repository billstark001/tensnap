import { Line } from '@leafer-ui/core';
import { BaseLayer } from './BaseLayer';
import type { EnvironmentViewFitMode } from '../host';
import {
  TrajectoryDelta,
  TrajectoryEntry,
  TrajectoryStorage,
  TrajectoryStorageData,
} from '../storages/TrajectoryStorage';
import { AgentId, GridCoordOffset, Viewport } from '../types';
import { getCoordOffsetValue } from '../utils';
import { resolveTrajectoryRenderStyle, splitTrajectoryPoints, TrajectoryWorldBounds } from '../utils/trajectory';

export interface TrajectoryLayerConfig {
  coordOffset?: GridCoordOffset;
  worldBounds?: TrajectoryWorldBounds;
}

interface TrajectoryLineCacheEntry {
  lines: Line[];
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

    const idsToRefresh = new Set<AgentId>([
      ...delta.created,
      ...delta.updated,
      ...delta.appended,
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
    const points = entry.ring.toArray();
    const style = resolveTrajectoryRenderStyle(points, {
      color: entry.defaultColor,
      width: entry.width,
    });
    const strokeWidth = this._toSceneStroke(style.width);
    const segments = splitTrajectoryPoints(points, this._cfg.worldBounds);

    if (segments.length === 0) {
      this._removeLine(id);
      return;
    }

    let cached = this._lines.get(id);
    if (!cached || cached.color !== style.color) {
      this._removeLine(id);
      cached = { lines: [], color: style.color, width: style.width };
      this._lines.set(id, cached);
    }

    cached.width = style.width;

    while (cached.lines.length < segments.length) {
      const line = new Line({ stroke: style.color, strokeWidth, points: [] });
      this.group.add(line);
      cached.lines.push(line);
    }

    while (cached.lines.length > segments.length) {
      cached.lines.pop()?.remove();
    }

    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      const segment = segments[segmentIndex];
      const flatPoints = new Array<number>(segment.length * 2);
      for (let pointIndex = 0; pointIndex < segment.length; pointIndex += 1) {
        flatPoints[pointIndex * 2] = segment[pointIndex].x + this._posOffset;
        flatPoints[pointIndex * 2 + 1] = segment[pointIndex].y + this._posOffset;
      }
      cached.lines[segmentIndex].set({ points: flatPoints, strokeWidth });
    }
  }

  private _updateStrokeWidths(): void {
    for (const cached of this._lines.values()) {
      const strokeWidth = this._toSceneStroke(cached.width);
      for (const line of cached.lines) {
        line.set({ strokeWidth });
      }
    }
  }

  private _removeLine(id: AgentId): void {
    const cached = this._lines.get(id);
    if (!cached) {
      return;
    }
    for (const line of cached.lines) {
      line.remove();
    }
    this._lines.delete(id);
  }

  private _clearLines(): void {
    for (const cached of this._lines.values()) {
      for (const line of cached.lines) {
        line.remove();
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