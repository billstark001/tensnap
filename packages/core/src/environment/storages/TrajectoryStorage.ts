import { BaseStorage } from './BaseStorage';
import type { AgentId, TrajectoryItem, TrajectoryPoint } from '@tensnap/protocol/layers';
import type { GlobalTrajectoryConfig } from '../types';
import { DEFAULT_TRAJECTORY_CONFIG, resolveTrajectoryConfig, RingBuffer } from '../utils';

// ── Public types ──────────────────────────────────────────────────────────────

/** Renderer-owned trajectory state grouped into per-agent segments. */
export interface TrajectoryStorageData {
  config: GlobalTrajectoryConfig;
  configs: Map<AgentId, TrajectoryItem>;
  trajectories: Map<AgentId, TrajectoryEntry>;
}

export interface TrajectorySnapshotItem {
  id: AgentId;
  /**
   * Flattened compatibility view of all segments. New snapshots additionally
   * carry `segments` when an id has been reused after a retained deletion.
   */
  points: TrajectoryPoint[];
  segments?: TrajectoryPoint[][];
  /** True when the source agent disappeared and a reused id must start a new segment. */
  closed?: boolean;
}

export interface TrajectoryStorageSnapshot {
  config: GlobalTrajectoryConfig;
  configs: TrajectoryItem[];
  trajectories: TrajectorySnapshotItem[];
}

// ── TrajectoryEntry ───────────────────────────────────────────────────────────

/**
 * Per-agent storage wrapper.
 *
 * The resolved color is stored here **once** rather than injected into every
 * point object, saving one string reference (~8 bytes) per stored point.
 * The color is reattached to points only when exporting via `dump()`.
 */
export interface TrajectoryEntry {
  /** The segment receiving incremental appends. */
  activeSegment: RingBuffer<TrajectoryPoint>;
  /** Historical segments in chronological order, including `activeSegment`. */
  segments: RingBuffer<TrajectoryPoint>[];
  /** A retained deletion closes the current segment until the id reappears. */
  closed: boolean;
  /** Cached resolved length limit (0 = unbounded). Used to detect config changes. */
  limit: number;
  /** Cached resolved stroke width. */
  width: number;
  /** Cached resolved color. Serves as the fallback for points without an explicit color. */
  defaultColor: string;
}

export interface TrajectoryAppendDelta {
  id: AgentId;
  point: TrajectoryPoint;
  /** Defined when the active ring wrapped and must be locally rebuilt. */
  evicted?: TrajectoryPoint;
  /** The append opened a new logical segment after a retained deletion. */
  startedSegment: boolean;
}

export type TrajectoryDelta = {
  created: AgentId[];
  updated: AgentId[];
  appended: AgentId[];
  /** Point-level append data for renderers that can update their tail chunk. */
  appendDeltas?: TrajectoryAppendDelta[];
  deleted: AgentId[];
  replaced?: false;
} | {
  created?: undefined;
  updated?: undefined;
  appended?: undefined;
  deleted?: undefined;
  replaced: true;
};

// ── TrajectoryStorage ─────────────────────────────────────────────────────────

export class TrajectoryStorage extends BaseStorage<TrajectoryStorageData, TrajectoryDelta> {

  constructor(defaultConfig?: Partial<GlobalTrajectoryConfig>) {
    const parsedConfig = resolveTrajectoryConfig(defaultConfig, DEFAULT_TRAJECTORY_CONFIG);
    super({
      config: parsedConfig,
      configs: new Map(),
      trajectories: new Map(),
    });
  }

  // ── Snapshot ────────────────────────────────────────────────────────────────

  override dump(): TrajectoryStorageSnapshot {
    const { config, configs, trajectories } = this._data;
    return {
      config: { ...config },
      configs: [...configs.values()],
      trajectories: [...trajectories.entries()].map(([id, entry]) => {
        const segments = entry.segments
          .map((segment) => this.materializePoints(segment, entry.defaultColor))
          .filter((segment) => segment.length > 0);
        const item: TrajectorySnapshotItem = {
          id,
          points: segments.flat(),
        };
        // Retain the old compact snapshot shape for the common one-segment
        // case, while preserving disjoint segments when an id is reused.
        if (segments.length > 1) {
          item.segments = segments;
        }
        if (entry.closed) {
          item.closed = true;
        }
        return item;
      }),
    };
  }

  override load(snapshot: unknown): void {
    const value = snapshot as TrajectoryStorageSnapshot;
    this.setConfig(value?.config ?? {});
    this.upsertConfigs(value?.configs ?? []);
    this.setTrajectories(value?.trajectories ?? []);
  }

  // ── Config ──────────────────────────────────────────────────────────────────

  setConfig(config: Partial<GlobalTrajectoryConfig>): void {
    const nextConfig = resolveTrajectoryConfig(config, this._data.config);
    this._data.config = nextConfig;
    this.refreshEntries(this._data.trajectories.keys());
    this.notify({ replaced: true });
  }

  upsertConfig(config: TrajectoryItem): void {
    const created = !this._data.configs.has(config.id);
    this._data.configs.set(config.id, config);
    this.refreshEntries([config.id]);
    this.notify({ created: created ? [config.id] : [], updated: created ? [] : [config.id], appended: [], deleted: [] });
  }

  upsertConfigs(configs: TrajectoryItem[]): void {
    const created: AgentId[] = [];
    const updated: AgentId[] = [];
    for (const config of configs) {
      if (this._data.configs.has(config.id)) {
        updated.push(config.id);
      } else {
        created.push(config.id);
      }
      this._data.configs.set(config.id, config);
    }
    this.refreshEntries(configs.map((config) => config.id));
    if (created.length > 0 || updated.length > 0) {
      this.notify({ created, updated, appended: [], deleted: [] });
    }
  }

  deleteItem(id: AgentId): void {
    this.deleteItems([id]);
  }

  deleteItems(ids: Iterable<AgentId>): void {
    const deleted: AgentId[] = [];
    for (const id of ids) {
      const removedConfig = this._data.configs.delete(id);
      const removedTrajectory = this._data.trajectories.delete(id);
      if (removedConfig || removedTrajectory) {
        deleted.push(id);
      }
    }
    if (deleted.length > 0) {
      this.notify({ created: [], updated: [], appended: [], deleted });
    }
  }

  clearItems(): void {
    if (this._data.configs.size > 0 || this._data.trajectories.size > 0) {
      this._data.configs.clear();
      this._data.trajectories.clear();
      this.notify({ replaced: true });
    }
  }

  /** Clear accumulated path points while retaining simulator-owned configs. */
  clearTrajectories(): void {
    if (this._data.trajectories.size === 0) {
      return;
    }
    this._data.trajectories.clear();
    this.notify({ replaced: true });
  }

  /**
   * Close a trace without throwing it away. The next append for this id starts
   * a new segment, preventing a line between a deleted agent and its reuse.
   */
  closeTrajectory(id: AgentId): void {
    const entry = this._data.trajectories.get(id);
    if (!entry || entry.closed) {
      return;
    }
    entry.closed = true;
    this.notify({ created: [], updated: [id], appended: [], deleted: [] });
  }

  closeTrajectories(ids: Iterable<AgentId>): void {
    const closed: AgentId[] = [];
    for (const id of ids) {
      const entry = this._data.trajectories.get(id);
      if (entry && !entry.closed) {
        entry.closed = true;
        closed.push(id);
      }
    }
    if (closed.length > 0) {
      this.notify({ created: [], updated: closed, appended: [], deleted: [] });
    }
  }

  /** Reconcile stored traces with a fully replayed source agent layer. */
  reconcileAgentIds(ids: Iterable<AgentId>, policy: 'delete' | 'retain'): void {
    const liveIds = new Set(ids);
    const staleIds = new Set<AgentId>();
    for (const id of this._data.trajectories.keys()) {
      if (!liveIds.has(id)) staleIds.add(id);
    }
    for (const id of this._data.configs.keys()) {
      if (!liveIds.has(id)) staleIds.add(id);
    }
    if (policy === 'delete') {
      this.deleteItems(staleIds);
    } else {
      this.closeTrajectories(staleIds);
    }
  }

  // ── Trajectory ──────────────────────────────────────────────────────────────

  appendTrajectoryPoint(id: AgentId, point: TrajectoryPoint): void {
    const resolved = this.resolveConfig(id);

    let entry = this._data.trajectories.get(id);
    const created = entry === undefined;

    if (entry === undefined) {
      entry = this.createEntry(resolved.length, resolved.width, resolved.color);
      this._data.trajectories.set(id, entry);
    } else {
      this.applyResolvedConfig(entry, resolved);
    }

    let startedSegment = false;
    if (entry.closed) {
      const segment = new RingBuffer<TrajectoryPoint>(resolved.length);
      entry.segments.push(segment);
      entry.activeSegment = segment;
      entry.closed = false;
      startedSegment = true;
    }

    const append = entry.activeSegment.push(point);
    this.notify({
      created: created ? [id] : [],
      updated: [],
      appended: created ? [] : [id],
      appendDeltas: [{ id, point, evicted: append.evicted, startedSegment }],
      deleted: [],
    });
  }

  setTrajectories(trajectories: TrajectorySnapshotItem[]): void {
    const map = new Map<AgentId, TrajectoryEntry>();

    for (const { id, points, segments: snapshotSegments, closed = false } of trajectories) {
      const sourceSegments = snapshotSegments?.length ? snapshotSegments : [points];
      if (!sourceSegments.some((segment) => segment?.length)) continue;

      const resolved = this.resolveConfig(id);
      const segments = sourceSegments
        .filter((segment) => segment?.length)
        .map((segment) => this.createSegment(segment, resolved.length));
      const activeSegment = segments[segments.length - 1];

      map.set(id, {
        activeSegment,
        segments,
        closed,
        limit: resolved.length,
        width: resolved.width,
        defaultColor: resolved.color,
      });
    }

    this._data.trajectories = map;
    this.notify({ replaced: true });
  }

  getEntry(id: AgentId): TrajectoryEntry | undefined {
    return this._data.trajectories.get(id);
  }

  private resolveConfig(id: AgentId): GlobalTrajectoryConfig {
    const config = this._data.configs.get(id);
    return resolveTrajectoryConfig(config, this._data.config);
  }

  private refreshEntries(ids: Iterable<AgentId>): void {
    for (const id of ids) {
      const entry = this._data.trajectories.get(id);
      if (!entry) {
        continue;
      }
      this.applyResolvedConfig(entry, this.resolveConfig(id));
    }
  }

  /**
   * Keep resolved visual config in one place. Resizing a ring materializes and
   * copies its contents, so only do it when the retention length changed;
   * width/color updates are hot metadata edits and must stay O(1).
   */
  private applyResolvedConfig(entry: TrajectoryEntry, config: GlobalTrajectoryConfig): void {
    if (entry.limit !== config.length) {
      entry.segments = entry.segments.map((segment) => segment.resize(config.length));
      entry.activeSegment = entry.segments[entry.segments.length - 1];
      entry.limit = config.length;
    }
    entry.width = config.width;
    entry.defaultColor = config.color;
  }

  private createEntry(length: number, width: number, color: string): TrajectoryEntry {
    const activeSegment = new RingBuffer<TrajectoryPoint>(length);
    return {
      activeSegment,
      segments: [activeSegment],
      closed: false,
      limit: length,
      width,
      defaultColor: color,
    };
  }

  private createSegment(points: TrajectoryPoint[], length: number): RingBuffer<TrajectoryPoint> {
    const segment = new RingBuffer<TrajectoryPoint>(length);
    const start = length > 0 ? Math.max(0, points.length - length) : 0;
    for (let i = start; i < points.length; i += 1) {
      segment.push(points[i]);
    }
    return segment;
  }

  private materializePoints(segment: RingBuffer<TrajectoryPoint>, defaultColor: string): TrajectoryPoint[] {
    return segment.toArray().map((point) => ({
      ...point,
      color: point.color || defaultColor,
    }));
  }
}
