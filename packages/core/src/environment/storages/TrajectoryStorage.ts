import { BaseStorage } from './BaseStorage';
import { AgentId, GlobalTrajectoryConfig, TrajectoryConfig, TrajectoryPoint } from '../types';
import { RingBuffer } from '../utils';

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Breaking change: `trajectories` now maps to `TrajectoryEntry` instead of
 * `TrajectoryPoint[]`. Direct consumers of `_data.trajectories` must be updated
 * to iterate `entry.ring` and resolve color via `entry.defaultColor`.
 */
export interface TrajectoryStorageData {
  config: GlobalTrajectoryConfig;
  configs: Map<AgentId, TrajectoryConfig>;
  trajectories: Map<AgentId, TrajectoryEntry>;
}

export interface TrajectorySnapshotItem {
  id: AgentId;
  points: TrajectoryPoint[];
}

export interface TrajectoryStorageSnapshot {
  config: GlobalTrajectoryConfig;
  configs: TrajectoryConfig[];
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
  ring: RingBuffer<TrajectoryPoint>;
  /** Cached resolved length limit (0 = unbounded). Used to detect config changes. */
  limit: number;
  /** Cached resolved stroke width. */
  width: number;
  /** Cached resolved color. Serves as the fallback for points without an explicit color. */
  defaultColor: string;
}

export type TrajectoryDelta = {
  created: AgentId[];
  updated: AgentId[];
  appended: AgentId[];
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

const DEFAULT_MAX_TRAJECTORY = 1000;

const defaultConfigValues: GlobalTrajectoryConfig = {
  length: DEFAULT_MAX_TRAJECTORY,
  width: 2,
  color: '#0080ff',
};

export class TrajectoryStorage extends BaseStorage<TrajectoryStorageData, TrajectoryDelta> {

  constructor(defaultConfig?: Partial<GlobalTrajectoryConfig>) {
    const parsedConfig: GlobalTrajectoryConfig = {
      ...defaultConfigValues,
      ...defaultConfig,
    };
    if (!Number.isFinite(parsedConfig.length) || parsedConfig.length < 0) {
      parsedConfig.length = DEFAULT_MAX_TRAJECTORY;
    }
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
      trajectories: [...trajectories.entries()].map(([id, entry]) => ({
        id,
        // Materialize color onto each point: per-point override takes precedence,
        // otherwise fall back to the trajectory-level defaultColor.
        points: entry.ring.toArray().map((point) => ({
          ...point,
          color: point.color || entry.defaultColor,
        })),
      })),
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
    const nextConfig: GlobalTrajectoryConfig = {
      ...this._data.config,
      ...config,
    };
    if (!Number.isFinite(nextConfig.length) || nextConfig.length < 0) {
      nextConfig.length = DEFAULT_MAX_TRAJECTORY;
    }
    this._data.config = nextConfig;
    this.refreshEntries(this._data.trajectories.keys());
    this.notify({ replaced: true });
  }

  upsertConfig(config: TrajectoryConfig): void {
    const created = !this._data.configs.has(config.id);
    this._data.configs.set(config.id, config);
    this.refreshEntries([config.id]);
    this.notify({ created: created ? [config.id] : [], updated: created ? [] : [config.id], appended: [], deleted: [] });
  }

  upsertConfigs(configs: TrajectoryConfig[]): void {
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

  // ── Trajectory ──────────────────────────────────────────────────────────────

  appendTrajectoryPoint(id: AgentId, point: TrajectoryPoint): void {
    const resolved = this.resolveConfig(id);

    let entry = this._data.trajectories.get(id);

    if (entry === undefined) {
      entry = {
        ring: new RingBuffer<TrajectoryPoint>(resolved.length),
        limit: resolved.length,
        width: resolved.width,
        defaultColor: resolved.color,
      };
      this._data.trajectories.set(id, entry);
    } else if (
      entry.limit !== resolved.length
      || entry.width !== resolved.width
      || entry.defaultColor !== resolved.color
    ) {
      entry.ring = entry.ring.resize(resolved.length);
      entry.limit = resolved.length;
      entry.width = resolved.width;
      entry.defaultColor = resolved.color;
    } else {
      entry.width = resolved.width;
      entry.defaultColor = resolved.color;
    }

    entry.ring.push(point);
    this.notify({ created: entry.ring.size === 1 ? [id] : [], updated: [], appended: entry.ring.size === 1 ? [] : [id], deleted: [] });
  }

  setTrajectories(trajectories: TrajectorySnapshotItem[]): void {
    const map = new Map<AgentId, TrajectoryEntry>();

    for (const { id, points } of trajectories) {
      if (!points?.length) continue;

      const resolved = this.resolveConfig(id);

      const ring = new RingBuffer<TrajectoryPoint>(resolved.length);
      const start = resolved.length > 0 ? Math.max(0, points.length - resolved.length) : 0;
      for (let i = start; i < points.length; i++) {
        ring.push(points[i]);
      }

      map.set(id, {
        ring,
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
    return {
      length: typeof config?.length === 'number' ? config.length : this._data.config.length,
      width: typeof config?.width === 'number' ? config.width : this._data.config.width,
      color: typeof config?.color === 'string' ? config.color : this._data.config.color,
    };
  }

  private refreshEntries(ids: Iterable<AgentId>): void {
    for (const id of ids) {
      const entry = this._data.trajectories.get(id);
      if (!entry) {
        continue;
      }
      const resolved = this.resolveConfig(id);
      entry.ring = entry.ring.resize(resolved.length);
      entry.limit = resolved.length;
      entry.width = resolved.width;
      entry.defaultColor = resolved.color;
    }
  }
}