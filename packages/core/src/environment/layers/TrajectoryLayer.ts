import { Line } from '@leafer-ui/core';
import { BaseLayer } from './BaseLayer';
import { EnvironmentView, EnvironmentViewFitMode } from '../EnvironmentView';
import {
  TrajectoryDelta,
  TrajectoryEntry,
  TrajectoryStorage,
  TrajectoryStorageData,
} from '../storages/TrajectoryStorage';
import { AgentId, GridCoordOffset, Viewport } from '../types';
import { getCoordOffsetValue } from '../utils';

const DEFAULT_TRAJECTORY_COLOR = 'rgba(66, 133, 244, 0.5)';

export interface TrajectoryLayerConfig {
  coordOffset?: GridCoordOffset;
}

interface TrajectoryLineCacheEntry {
  line: Line;
  color: string;
  width: number;
}

export class TrajectoryLayer extends BaseLayer {
  readonly defaultZIndex = 30;

  private readonly _cfg: Required<TrajectoryLayerConfig>;
  private readonly _lines = new Map<AgentId, TrajectoryLineCacheEntry>();

  constructor(
    view: EnvironmentView,
    storage: TrajectoryStorage,
    config: TrajectoryLayerConfig = {},
  ) {
    super(view);
    this._cfg = {
      coordOffset: 'int',
      ...config,
    };

    this.registerStorage(storage, (data, delta) => this._onTrajectoryData(data, delta));
    this._onTrajectoryData(storage.getData(), { replaced: true });
  }

  onViewportChange(viewport: Viewport, fitMode: EnvironmentViewFitMode): void {
    this.applyViewportTransform(viewport, fitMode);
    this._updateStrokeWidths();
  }

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
    const color = points.find((point) => point.color)?.color ?? entry.defaultColor ?? DEFAULT_TRAJECTORY_COLOR;
    const strokeWidth = this._toSceneStroke(entry.width);

    let cached = this._lines.get(id);
    if (!cached || cached.color !== color) {
      cached?.line.remove();
      const line = new Line({ stroke: color, strokeWidth, points: [] });
      cached = { line, color, width: entry.width };
      this.group.add(line);
      this._lines.set(id, cached);
    }

    cached.width = entry.width;

    if (points.length < 2) {
      cached.line.set({ points: [], strokeWidth });
      return;
    }

    const flatPoints = new Array<number>(points.length * 2);
    for (let i = 0; i < points.length; i++) {
      flatPoints[i * 2] = points[i].x + this._posOffset;
      flatPoints[i * 2 + 1] = points[i].y + this._posOffset;
    }

    cached.line.set({ points: flatPoints, strokeWidth });
  }

  private _updateStrokeWidths(): void {
    for (const cached of this._lines.values()) {
      cached.line.set({ strokeWidth: this._toSceneStroke(cached.width) });
    }
  }

  private _removeLine(id: AgentId): void {
    const cached = this._lines.get(id);
    if (!cached) {
      return;
    }
    cached.line.remove();
    this._lines.delete(id);
  }

  private _clearLines(): void {
    for (const cached of this._lines.values()) {
      cached.line.remove();
    }
    this._lines.clear();
  }

  destroy(): void {
    this._clearLines();
    super.destroy();
  }
}