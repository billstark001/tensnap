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
  sceneBounds?: SceneBounds | Partial<Viewport>;

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
  /** Single polyline that draws the entire trajectory. */
  line: Line;
  lastRenderedIndex: number;
  color: string;
  /** Flat coordinate array [x0,y0, x1,y1, …] feeding the polyline. */
  flatPoints: number[];
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
  private _cachedAgents = new Map<AgentId, RenderableAgent>();
  private _draggingId: AgentId | null = null;

  // #endregion

  // #region Constructor

  constructor(
    view: EnvironmentView,
    agentStorage: AgentStorage,
    config: AgentLayerConfig = {},
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
      sceneBounds: undefined,
    };

    if (config.sceneBounds) {
      if ('width' in config.sceneBounds || 'height' in config.sceneBounds) {
        const { x = 0, y = 0, width = 1, height = 1 } = config.sceneBounds;
        this._cfg.sceneBounds = {
          minX: x,
          maxX: x + width,
          minY: y,
          maxY: y + height,
        };
      } else {
        this._cfg.sceneBounds = config.sceneBounds as SceneBounds;
      }
    }

    this.group.add(this._trajGroup);
    this.group.add(this._agentsGroup);

    this.registerStorage(agentStorage, (data, delta) => this._onAgentData(data, delta));
    this._onAgentData(agentStorage.getData());

  }

  // #endregion

  // #region IBoundedLayer

  getSceneBounds(): SceneBounds | null {
    if (this._cfg.sceneBounds) return this._cfg.sceneBounds;

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
    // Trajectory points are in scene coordinates — no rebuild needed;
    // only re-set the stroke width so lines keep a constant pixel thickness.
    this._updateTrajStrokeWidths();
  }

  // #endregion

  // #region Data

  private _onAgentData(data: AgentStorageData, delta: AgentDelta = { replaced: true }): void {
    this._cachedAgents = data.agents;

    // Fast path: only node positions changed (d3-force tick).
    // Skip structural changes and trajectory sync to avoid per-frame allocation storms.
    if (delta.positionsFlushed) {
      this._flushPositionsOnly(data.agents);
      return;
    }

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

  /**
   * Tight loop that only updates group x/y/rotation from agent positions.
   * Called every d3-force tick via `flushPositions()`.
   * Avoids all color/icon/size checks, trajectory syncing, and GC-heavy operations.
   */
  private _flushPositionsOnly(agents: Map<AgentId, RenderableAgent>): void {
    agents.forEach((agent, id) => {
      const entry = this._agentShapes.get(id);
      if (!entry) return;
      const coords = this._toSceneCoords(agent);
      entry.group.set({ x: coords.x, y: coords.y, rotation: coords.rotation });
    });
  }

  // #endregion

  // #region Coordinate Transform

  /** Cell-center offset in grid mode: 0.5 for 'int', 0 for 'center'. */
  private get _posOffset(): number {
    return this._cfg.coordOffset === 'int' ? 0.5 : 0;
  }

  private _toSceneCoords(agent: RenderableAgent) {
    const off = this._posOffset;
    return {
      x: (agent.x ?? 0) + off,
      y: (agent.y ?? 0) + off,
      rotation: agent.heading ? (agent.heading * 180) / Math.PI : 0,
      size: agent.size ?? 1,
    };
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

    // Batch shape appearance changes into a single set() call
    const shapeUpdates: Record<string, unknown> = {};
    if (entry.icon !== icon || entry.size !== coords.size) {
      Object.assign(shapeUpdates, SHAPE_CONFIGS[icon](coords.size));
      entry.icon = icon;
      entry.size = coords.size;
    }
    if (entry.color !== color) {
      shapeUpdates.fill = color;
      entry.color = color;
    }
    if (Object.keys(shapeUpdates).length) entry.shape.set(shapeUpdates);
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
    entry.group.off?.();
    entry.group.remove();
    this._agentShapes.delete(id);
    this._removeTrajectory(String(id));
  }

  private _clearAgents(): void {
    for (const entry of this._agentShapes.values()) {
      entry.shape.off?.();
      entry.group.off?.();
    }
    this._agentShapes.clear();
    this._agentsGroup.clear();  // bulk-remove all agent groups in one call
    for (const cached of this._trajectoryCache.values()) cached.line.remove();
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

  /**
   * Replace a per-agent trajectory with a single polyline `Line` whose
   * `points` array contains all trajectory coordinates.
   *
   * Complexity per call: O(P) array allocation, 1 Leafer `set()` call —
   * vs. the previous O(P) individual `Line` objects.
   */
  private _updateTrajectory(agentId: string, points: TrajectoryPoint[], color?: string): void {
    const trajColor = color ?? DEFAULT_TRAJ_COLOR;
    const strokeWidth = this._trajStrokeWidth();
    const off = this._posOffset;

    let cached = this._trajectoryCache.get(agentId);
    if (!cached || cached.color !== trajColor) {
      cached?.line.remove();
      const line = new Line({ stroke: trajColor, strokeWidth, points: [] });
      cached = { line, lastRenderedIndex: -1, color: trajColor, flatPoints: [] };
      this._trajGroup.add(line);
      this._trajectoryCache.set(agentId, cached);
    }

    if (points.length < 2) {
      if (cached.flatPoints.length > 0) {
        cached.flatPoints = [];
        cached.line.set({ points: [] });
      }
      cached.lastRenderedIndex = points[points.length - 1]?.time ?? -1;
      return;
    }

    // Build a flat [x0,y0, x1,y1, …] array — one polyline replaces N-1 Line objects
    const n = points.length;
    const flatPoints = new Array<number>(n * 2);
    for (let i = 0; i < n; i++) {
      flatPoints[i * 2] = points[i].x + off;
      flatPoints[i * 2 + 1] = points[i].y + off;
    }
    cached.flatPoints = flatPoints;
    cached.line.set({ points: flatPoints, strokeWidth });
    cached.lastRenderedIndex = points[n - 1]?.time ?? -1;
  }

  private _removeTrajectory(agentId: string): void {
    const cached = this._trajectoryCache.get(agentId);
    if (!cached) return;
    cached.line.remove();
    this._trajectoryCache.delete(agentId);
  }

  /**
   * Refresh stroke widths for all cached polylines after a viewport scale
   * change. Points are already in scene coordinates so no rebuild is needed.
   */
  private _updateTrajStrokeWidths(): void {
    const strokeWidth = this._trajStrokeWidth();
    for (const cached of this._trajectoryCache.values()) {
      cached.line.set({ strokeWidth });
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