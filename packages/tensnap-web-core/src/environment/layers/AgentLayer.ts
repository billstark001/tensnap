/**
 * environment/layers/AgentLayer.ts
 *
 * Unified agent rendering layer. Supports:
 *   Grid mode  — x/y are grid-cell coordinates; GridEnvStorage supplies cell
 *                count; heading rotates the shape.
 *   Graph mode — x/y are canvas-pixel coordinates (managed by EdgeLayer's
 *                d3-force simulation); drag interaction via config callbacks.
 *
 * Each agent: one Group containing a shape + optional label.
 * Trajectories live in a sub-group rendered below agents.
 *
 * Default z-index: 40
 * Registered storages: AgentStorage (required), GridEnvStorage (optional)
 */

import {
  Group,
  UI,
  Text,
  Line,
  PointerEvent as LeaferPointerEvent,
  DragEvent as LeaferDragEvent,
} from 'leafer-ui';
import { BaseLayer } from './BaseLayer';
import { EnvironmentView } from '../EnvironmentView';
import {
  AgentDelta,
  AgentStorage,
  AgentStorageData,
  RenderableAgent,
} from '../storages/AgentStorage';
import { GridEnvStorage, GridEnvData } from '../storages/GridEnvStorage';
import {
  Viewport,
  AgentId,
  AgentIcon,
  TrajectoryPoint,
  GridCoordOffset,
  SceneBounds,
  OriginMode,
  IBoundedLayer,
} from '../types';
import { SHAPE_CONFIGS, SHAPE_CLASSES, createAgentLabel } from '../utils/shape';

// #region Constants & Defaults

const DEFAULT_AGENT_COLOR = '#69b3a2';
const DEFAULT_TRAJ_COLOR = 'rgba(66, 133, 244, 0.5)';
const TRAJ_STROKE_PX = 2;
const NOOP = () => { };

/**
 * Baseline graph-mode config.
 *
 * • Node diameter          = 1 scene-unit  (agents default to `size = 1`).
 * • Average inter-node distance = 3 scene-units (1-unit diameter + 2-unit gap).
 *
 * Pair with `linkDistance: 3` in EdgeLayer's d3-force simulation to maintain
 * the intended spacing.
 */
export const DEFAULT_GRAPH_CONFIG: Readonly<AgentLayerConfig> = {
  draggable: false,
  showLabel: false,
  clickable: true,
  contextMenuable: false,
  originMode: 'center',
} as const;

// #endregion

// #region Config & Internal Types

export interface AgentLayerConfig {
  /** Enable drag-to-move (graph mode). Default: false. */
  draggable?: boolean;
  /** Show agent-id label below the shape. Default: false. */
  showLabel?: boolean;
  /** Register click events. Default: true. */
  clickable?: boolean;
  /** Register right-click / context-menu events. Default: false. */
  contextMenuable?: boolean;
  /** Grid coordinate offset mode. Default: 'int'. */
  coordOffset?: GridCoordOffset;
  /** Origin mode for agent positioning. Default: 'bottom-left'. */
  originMode?: OriginMode;
  /** Fixed scene bounds (graph mode). Calculated dynamically when omitted. */
  sceneBounds?: SceneBounds;

  onAgentClick?: (agent: RenderableAgent, event: any) => void;
  onAgentContextMenu?: (agent: RenderableAgent, event: any) => void;
  onAgentDoubleClick?: (agent: RenderableAgent) => void;
  onDragStart?: (id: AgentId, x: number, y: number) => void;
  onDragMove?: (id: AgentId, dx: number, dy: number) => void;
  onDragEnd?: (id: AgentId) => void;
}

type ResolvedConfig = Required<Omit<AgentLayerConfig, 'sceneBounds'>> & {
  sceneBounds?: SceneBounds;
};

interface AgentShapeEntry {
  group: Group;
  shape: UI;
  label: Text | null;
  icon: AgentIcon;
  size: number;
  color: string;
}

interface TrajectoryCacheEntry {
  group: Group;
  lastRenderedIndex: number;
  color: string;
}

// #endregion

// ---------------------------------------------------------------------------

export class AgentLayer extends BaseLayer implements IBoundedLayer {
  readonly defaultZIndex = 40;

  // #region Private fields

  private readonly _trajGroup = new Group();
  private readonly _agentsGroup = new Group();
  private readonly _agentShapes = new Map<AgentId, AgentShapeEntry>();
  private readonly _trajectoryCache = new Map<string, TrajectoryCacheEntry>();
  private readonly _cfg: ResolvedConfig;

  private _viewport: Viewport;
  private _gridEnv: GridEnvData | null = null;
  private _cachedAgents = new Map<AgentId, RenderableAgent>();
  private _trajectoryData = new Map<string, TrajectoryPoint[]>();
  private _draggingId: AgentId | null = null;

  // #endregion

  // #region Constructor

  constructor(
    view: EnvironmentView,
    agentStorage: AgentStorage,
    config: AgentLayerConfig = {},
    gridEnvStorage?: GridEnvStorage,
  ) {
    super(view);
    this._viewport = view.viewport;

    this._cfg = {
      draggable: false,
      showLabel: false,
      clickable: true,
      contextMenuable: false,
      coordOffset: 'int',
      originMode: 'bottom-left',
      onAgentClick: NOOP,
      onAgentContextMenu: NOOP,
      onAgentDoubleClick: NOOP,
      onDragStart: NOOP,
      onDragMove: NOOP,
      onDragEnd: NOOP,
      ...config,
    };

    this.group.add(this._trajGroup);
    this.group.add(this._agentsGroup);

    this.registerStorage(agentStorage, (data, delta) => this._onAgentData(data, delta));
    this._onAgentData(agentStorage.getData());

    if (gridEnvStorage) {
      this._gridEnv = gridEnvStorage.getData();
      this.registerStorage(gridEnvStorage, (env) => {
        this._gridEnv = env;
        this._onAgentData(agentStorage.getData());
      });
    }
  }

  // #endregion

  // #region IBoundedLayer

  getSceneBounds(): SceneBounds | null {
    if (this._cfg.sceneBounds) return this._cfg.sceneBounds;

    if (this._gridEnv) {
      const { width: cols, height: rows } = this._gridEnv;
      if (cols <= 0 || rows <= 0) return null;
      return this._cfg.originMode === 'center'
        ? { minX: -cols / 2, maxX: cols / 2, minY: -rows / 2, maxY: rows / 2 }
        : { minX: 0, maxX: cols, minY: 0, maxY: rows };
    }

    return this._boundsFromAgents();
  }

  getOriginMode(): OriginMode {
    return this._cfg.originMode;
  }

  private _boundsFromAgents(): SceneBounds | null {
    if (!this._cachedAgents.size) return null;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const { x = 0, y = 0, size = 1 } of this._cachedAgents.values()) {
      const h = size / 2;
      if (x - h < minX) minX = x - h;
      if (x + h > maxX) maxX = x + h;
      if (y - h < minY) minY = y - h;
      if (y + h > maxY) maxY = y + h;
    }

    if (!isFinite(minX)) return null;

    const px = (maxX - minX) * 0.1;
    const py = (maxY - minY) * 0.1;
    return { minX: minX - px, maxX: maxX + px, minY: minY - py, maxY: maxY + py };
  }

  // #endregion

  // #region Viewport

  onViewportChange(viewport: Viewport): void {
    this._viewport = viewport;
    this.applyViewportTransform(viewport);
    this._rebuildAllTrajectories();
  }

  // #endregion

  // #region Data

  private _onAgentData(data: AgentStorageData, delta: AgentDelta = { replaced: true }): void {
    this._cachedAgents = data.agents;
    this._trajectoryData = data.trajectories;

    if (delta.replaced) {
      this._clearAgents();
      for (const agent of data.agents.values()) {
        this._createAgent(agent);
      }
    } else {
      delta.removed.forEach((id) => this._removeAgent(id));
      delta.added.forEach((agent) => this._createAgent(agent));
      delta.updated.forEach((agent) => this._updateAgent(agent));
    }

    // Sync trajectories — all agents on full replace, changed agents on delta
    const toSync: RenderableAgent[] = delta.replaced
      ? [...data.agents.values()]
      : [...delta.added, ...delta.updated];

    for (const agent of toSync) {
      const points = data.trajectories.get(String(agent.id));
      if (points) this._updateTrajectory(String(agent.id), points, agent.trajectoryColor);
    }
  }

  // #endregion

  // #region Coordinate Transform

  /** Cell-center offset in grid mode: 0.5 for 'int', 0 for 'center'. */
  private get _posOffset(): number {
    return this._cfg.coordOffset === 'int' ? 0.5 : 0;
  }

  private _toSceneCoords(agent: RenderableAgent) {
    if (this._gridEnv) {
      const off = this._posOffset;
      return {
        x: (agent.x ?? 0) + off,
        y: (agent.y ?? 0) + off,
        rotation: agent.heading ? (agent.heading * 180) / Math.PI : 0,
        size: agent.size ?? 1,
      };
    }
    // Graph mode: size defaults to 1 (diameter = 1 scene-unit; see DEFAULT_GRAPH_CONFIG)
    return { x: agent.x ?? 0, y: agent.y ?? 0, rotation: 0, size: agent.size ?? 1 };
  }

  /** Trajectory stroke width in scene units — renders at a constant pixel width regardless of zoom. */
  private _trajStrokeWidth(): number {
    const s = this.calculateViewportScale(this._viewport);
    const avg = (Math.abs(s.scaleX) + Math.abs(s.scaleY)) / 2;
    return Math.max(0.1, TRAJ_STROKE_PX / avg);
  }

  // #endregion

  // #region Agent CRUD

  private _createAgent(agent: RenderableAgent): void {
    const coords = this._toSceneCoords(agent);
    const icon = agent.icon ?? 'circle';
    const color = agent.color ?? DEFAULT_AGENT_COLOR;

    const shape: UI = new SHAPE_CLASSES[icon]({
      ...SHAPE_CONFIGS[icon](coords.size),
      fill: color,
    });
    const label = this._cfg.showLabel ? createAgentLabel(agent.id, coords.size) : null;
    const group = new Group({ x: coords.x, y: coords.y, rotation: coords.rotation });

    group.add(shape);
    if (label) group.add(label);

    this._bindEvents(shape, group, agent.id);
    this._agentsGroup.add(group);
    this._agentShapes.set(agent.id, { group, shape, label, icon, size: coords.size, color });
  }

  /** Merged shape-appearance + position update (the two are always applied together). */
  private _updateAgent(agent: RenderableAgent): void {
    const entry = this._agentShapes.get(agent.id);
    if (!entry) return;

    const coords = this._toSceneCoords(agent);
    const icon = agent.icon ?? 'circle';
    const color = agent.color ?? DEFAULT_AGENT_COLOR;

    if (entry.color !== color) {
      entry.shape.set({ fill: color });
      entry.color = color;
    }
    if (entry.icon !== icon || entry.size !== coords.size) {
      entry.shape.set(SHAPE_CONFIGS[icon](coords.size));
      entry.icon = icon;
      entry.size = coords.size;
    }
    if (entry.label) {
      const fs = Math.max(8, coords.size * 0.6);
      entry.label.set({
        text: String(agent.id),
        fontSize: fs,
        x: -coords.size,
        y: -fs / 2,
        width: coords.size * 2,
        height: fs,
      });
    }

    entry.group.set({ x: coords.x, y: coords.y, rotation: coords.rotation });
  }

  private _removeAgent(id: AgentId): void {
    const entry = this._agentShapes.get(id);
    if (!entry) return;
    entry.shape.off?.();
    entry.group.remove();
    this._agentShapes.delete(id);
    this._removeTrajectory(String(id));
  }

  private _clearAgents(): void {
    for (const entry of this._agentShapes.values()) {
      entry.shape.off?.();
      entry.group.remove();
    }
    this._agentShapes.clear();
    for (const cached of this._trajectoryCache.values()) cached.group.remove();
    this._trajectoryCache.clear();
  }

  // #endregion

  // #region Events

  private _bindEvents(shape: UI, group: Group, id: AgentId): void {
    const cfg = this._cfg;

    if (cfg.clickable) {
      shape.on(LeaferPointerEvent.CLICK, (e: any) => {
        const a = this._cachedAgents.get(id);
        if (a) cfg.onAgentClick(a, e);
      });
    }
    if (cfg.contextMenuable) {
      shape.on(LeaferPointerEvent.MENU, (e: any) => {
        const a = this._cachedAgents.get(id);
        if (a) cfg.onAgentContextMenu(a, e);
      });
    }
    if (cfg.draggable) this._attachDrag(group, id);

    group.on(LeaferPointerEvent.DOUBLE_TAP, (e: any) => {
      e.stop();
      const a = this._cachedAgents.get(id);
      if (a) cfg.onAgentDoubleClick(a);
    });
  }

  // #endregion

  // #region Drag

  private _attachDrag(group: Group, id: AgentId): void {
    const { onDragStart, onDragMove, onDragEnd } = this._cfg;

    group.on(LeaferDragEvent.START, (e: LeaferDragEvent) => {
      e.stop();
      this._draggingId = id;
      const agent = this._cachedAgents.get(id);
      onDragStart(id, agent?.x ?? 0, agent?.y ?? 0);
    });

    group.on(LeaferDragEvent.DRAG, (e: LeaferDragEvent) => {
      if (this._draggingId !== id) return;
      e.stop();
      onDragMove(id, e.moveX, e.moveY);
    });

    group.on(LeaferDragEvent.END, (e: LeaferDragEvent) => {
      if (this._draggingId !== id) return;
      e.stop();
      this._draggingId = null;
      onDragEnd(id);
    });
  }

  // #endregion

  // #region Trajectory

  private _updateTrajectory(agentId: string, points: TrajectoryPoint[], color?: string): void {
    const trajColor = color ?? DEFAULT_TRAJ_COLOR;
    const strokeWidth = this._trajStrokeWidth();
    const off = this._gridEnv ? this._posOffset : 0;

    let cached = this._trajectoryCache.get(agentId);
    if (!cached || cached.color !== trajColor) {
      cached?.group.remove();
      cached = { group: new Group(), lastRenderedIndex: -1, color: trajColor };
      this._trajGroup.add(cached.group);
      this._trajectoryCache.set(agentId, cached);
    }

    if (points.length < 2) {
      cached.group.clear();
      cached.lastRenderedIndex = points[points.length - 1]?.time ?? -1;
      return;
    }

    const startIdx = Math.max(0, cached.lastRenderedIndex);

    for (let i = points.length - 2; i >= 0; --i) {
      const p1 = points[i], p2 = points[i + 1];
      if (p2.time <= startIdx) break;
      cached.group.add(new Line({
        points: [p1.x + off, p1.y + off, p2.x + off, p2.y + off],
        stroke: p1.color ?? trajColor,
        strokeWidth,
      }));
    }

    // Trim excess segments to cap memory use
    const { children } = cached.group;
    const excess = children.length - (points.length - 1);
    if (excess > 0) children.slice(0, excess).forEach((c: any) => cached!.group.remove(c));

    cached.lastRenderedIndex = points[points.length - 1]?.time ?? startIdx;
  }

  private _removeTrajectory(agentId: string): void {
    const cached = this._trajectoryCache.get(agentId);
    if (!cached) return;
    cached.group.remove();
    this._trajectoryCache.delete(agentId);
  }

  private _rebuildAllTrajectories(): void {
    for (const cached of this._trajectoryCache.values()) {
      cached.group.clear();
      cached.lastRenderedIndex = -1;
    }
    for (const [id, points] of this._trajectoryData) {
      if (points?.length) {
        this._updateTrajectory(id, points, this._cachedAgents.get(id as AgentId)?.trajectoryColor);
      }
    }
  }

  // #endregion

  // #region Destroy

  destroy(): void {
    this._clearAgents();
    super.destroy();
  }

  // #endregion
}