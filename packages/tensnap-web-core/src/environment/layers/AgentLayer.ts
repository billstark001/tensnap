/**
 * environment/layers/AgentLayer.ts
 *
 * Unified agent rendering layer.  Supports both:
 *
 *   Grid mode  — x/y are grid-cell coordinates; a `GridEnvStorage` (optional)
 *                supplies the cell count so cellSize can be computed from the
 *                current viewport.  Heading rotates the shape.
 *
 *   Graph mode — x/y are canvas-pixel coordinates managed externally (by
 *                EdgeLayer's d3-force simulation).  Drag interaction is
 *                supported through config callbacks.
 *
 * Each agent has two Leafer shapes inside a group (shape + optional label).
 * Trajectories are rendered in a sub-group drawn before agents within the
 * same Leafer group (lower z within the layer).
 *
 * Default z-index: 30
 *
 * Registered storages:
 *   - AgentStorage  (required) — agent positions + trajectories
 *   - GridEnvStorage (optional) — if provided, switches to grid-coordinate mode
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
import { AgentStorage, AgentStorageData, RenderableAgent } from '../storages/AgentStorage';
import { GridEnvStorage, GridEnvData } from '../storages/GridEnvStorage';
import {
  Viewport,
  AgentId,
  AgentIcon,
  TrajectoryPoint,
  GridCoordOffset,
} from '../types';
import {
  SHAPE_CONFIGS,
  SHAPE_CLASSES,
  createAgentLabel,
} from '../utils/shape';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface AgentLayerConfig {
  /** Enable drag-to-move (graph mode). Default: false. */
  draggable?: boolean;
  /** Show agent-id label below the shape (graph mode). Default: false. */
  showLabel?: boolean;
  /** Register click events. Default: true. */
  clickable?: boolean;
  /** Register right-click / context-menu events. Default: false. */
  contextMenuable?: boolean;
  /** Grid coordinate offset mode.  Used when gridEnvStorage is provided. */
  coordOffset?: GridCoordOffset;

  // Interaction callbacks
  onAgentClick?: (agent: RenderableAgent, event: any) => void;
  onAgentContextMenu?: (agent: RenderableAgent, event: any) => void;
  onAgentDoubleClick?: (agent: RenderableAgent) => void;

  // Drag lifecycle callbacks (typically provided by EdgeLayer)
  onDragStart?: (id: AgentId, x: number, y: number) => void;
  onDragMove?: (id: AgentId, dx: number, dy: number) => void;
  onDragEnd?: (id: AgentId) => void;
}

// ---------------------------------------------------------------------------
// Internal shape cache
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// AgentLayer
// ---------------------------------------------------------------------------

export class AgentLayer extends BaseLayer {
  readonly defaultZIndex = 30;

  private readonly _trajGroup: Group;
  private readonly _agentsGroup: Group;

  private readonly _agentShapes: Map<AgentId, AgentShapeEntry> = new Map();
  private readonly _trajectoryCache: Map<string, TrajectoryCacheEntry> = new Map();
  private _trajectoryData: Map<string, TrajectoryPoint[]> = new Map();

  private _viewport: Viewport;
  private _gridEnv: GridEnvData | null = null;
  private readonly _cfg: Required<AgentLayerConfig>;

  /** Currently dragging agent id (graph mode only). */
  private _draggingId: AgentId | null = null;

  constructor(
    view: EnvironmentView,
    agentStorage: AgentStorage,
    config: AgentLayerConfig = {},
    gridEnvStorage?: GridEnvStorage
  ) {
    super(view);

    this._viewport = view.viewport;

    this._cfg = {
      draggable: false,
      showLabel: false,
      clickable: true,
      contextMenuable: false,
      coordOffset: 'int',
      onAgentClick: () => undefined,
      onAgentContextMenu: () => undefined,
      onAgentDoubleClick: () => undefined,
      onDragStart: () => undefined,
      onDragMove: () => undefined,
      onDragEnd: () => undefined,
      ...config,
    };

    // Trajectory sub-group — rendered below agents
    this._trajGroup = new Group();
    this._agentsGroup = new Group();
    this.group.add(this._trajGroup);
    this.group.add(this._agentsGroup);

    // Subscribe to agent data
    this.registerStorage(agentStorage, (data) => this._onAgentData(data));
    this._onAgentData(agentStorage.getData());

    // Optional: grid coordinate mode
    if (gridEnvStorage) {
      this._gridEnv = gridEnvStorage.getData();
      this.registerStorage(gridEnvStorage, (env) => {
        this._gridEnv = env;
        this._onAgentData(agentStorage.getData());
      });
    }
  }

  // -------------------------------------------------------------------------
  // Viewport
  // -------------------------------------------------------------------------

  onViewportChange(viewport: Viewport): void {
    this._viewport = viewport;
    // Rebuild trajectories with new cellSize
    this._rebuildAllTrajectories();
    // Reposition all agents
    this._agentShapes.forEach((_, id) => {
      const agent = this._getStoredAgent(id);
      if (agent) this._updateAgentPosition(agent);
    });
  }

  // -------------------------------------------------------------------------
  // Data change handler
  // -------------------------------------------------------------------------

  private _cachedAgents: Map<AgentId, RenderableAgent> = new Map();

  private _getStoredAgent(id: AgentId): RenderableAgent | undefined {
    return this._cachedAgents.get(id);
  }

  private _onAgentData(data: AgentStorageData): void {
    this._cachedAgents = data.agents;

    // Sync agent shapes
    const incoming = data.agents;
    // Remove stale
    this._agentShapes.forEach((_, id) => {
      if (!incoming.has(id)) this._removeAgent(id);
    });
    // Add / update
    incoming.forEach((agent) => {
      if (this._agentShapes.has(agent.id)) {
        this._updateAgentShape(agent);
        this._updateAgentPosition(agent);
      } else {
        this._createAgent(agent);
      }
    });

    // Sync trajectory data
    this._trajectoryData = data.trajectories;
    // Remove stale trajectory caches
    this._trajectoryCache.forEach((_, agentId) => {
      if (!incoming.has(agentId as AgentId)) this._removeTrajectory(agentId);
    });
    // Update trajectories
    data.trajectories.forEach((points, agentId) => {
      const agent = incoming.get(agentId as AgentId);
      this._updateTrajectory(agentId, points, agent?.trajectoryColor);
    });
  }

  // -------------------------------------------------------------------------
  // Coordinate transform
  // -------------------------------------------------------------------------

  private _cellSize(): number {
    if (!this._gridEnv) return 1; // graph mode — no scaling
    const { cellSize } = this._computeGridViewport();
    return cellSize;
  }

  private _computeGridViewport(): {
    cellSize: number;
    canvasWidth: number;
    canvasHeight: number;
  } {
    const { width, height } = this._viewport;
    const cols = this._gridEnv?.width ?? 1;
    const rows = this._gridEnv?.height ?? 1;
    const cw = width / cols;
    const ch = height / rows;
    const cellSize = Math.max(Math.min(cw, ch), 4);
    return {
      cellSize,
      canvasWidth: cellSize * cols,
      canvasHeight: cellSize * rows,
    };
  }

  /** Convert agent data to canvas-pixel {x, y, rotation, pixelSize}. */
  private _toCanvasCoords(agent: RenderableAgent): {
    x: number;
    y: number;
    rotation: number;
    pixelSize: number;
  } {
    if (this._gridEnv) {
      const { cellSize } = this._computeGridViewport();
      const coordOffset = agent.heading !== undefined
        ? (this._cfg.coordOffset ?? 'int')
        : this._cfg.coordOffset;
      const posDiff = coordOffset === 'int' ? cellSize / 2 : 0;
      return {
        x: (agent.x ?? 0) * cellSize + posDiff,
        y: (agent.y ?? 0) * cellSize + posDiff,
        rotation: agent.heading ? (agent.heading * 180) / Math.PI : 0,
        pixelSize: (agent.size ?? 10) * (cellSize / 10),
      };
    }
    // Graph / absolute mode
    return {
      x: agent.x ?? 0,
      y: agent.y ?? 0,
      rotation: 0,
      pixelSize: agent.size ?? 20,
    };
  }

  // -------------------------------------------------------------------------
  // Agent shape CRUD
  // -------------------------------------------------------------------------

  private _createAgent(agent: RenderableAgent): void {
    const coords = this._toCanvasCoords(agent);
    const icon = agent.icon ?? 'circle';
    const color = agent.color ?? '#69b3a2';

    const ShapeCls = SHAPE_CLASSES[icon];
    const shape: UI = new ShapeCls({
      ...SHAPE_CONFIGS[icon](coords.pixelSize),
      fill: color,
    });

    const group = new Group({ x: coords.x, y: coords.y, rotation: coords.rotation });
    group.add(shape);

    let label: Text | null = null;
    if (this._cfg.showLabel) {
      label = createAgentLabel(agent.id, coords.pixelSize);
      group.add(label);
    }

    // Events
    if (this._cfg.clickable) {
      shape.on(LeaferPointerEvent.CLICK, (e: any) => {
        const a = this._getStoredAgent(agent.id);
        if (a) this._cfg.onAgentClick(a, e);
      });
    }
    if (this._cfg.contextMenuable) {
      shape.on(LeaferPointerEvent.MENU, (e: any) => {
        const a = this._getStoredAgent(agent.id);
        if (a) this._cfg.onAgentContextMenu(a, e);
      });
    }
    if (this._cfg.draggable) {
      this._attachDrag(group, agent.id);
    }
    if (this._cfg.onAgentDoubleClick) {
      group.on(LeaferPointerEvent.DOUBLE_TAP, (e: any) => {
        e.stop();
        const a = this._getStoredAgent(agent.id);
        if (a) this._cfg.onAgentDoubleClick(a);
      });
    }

    this._agentsGroup.add(group);
    this._agentShapes.set(agent.id, {
      group,
      shape,
      label,
      icon,
      size: coords.pixelSize,
      color,
    });
  }

  private _updateAgentShape(agent: RenderableAgent): void {
    const entry = this._agentShapes.get(agent.id);
    if (!entry) return;

    const coords = this._toCanvasCoords(agent);
    const icon = agent.icon ?? 'circle';
    const color = agent.color ?? '#69b3a2';

    // Update color
    if (entry.color !== color) {
      entry.shape.set({ fill: color });
      entry.color = color;
    }

    // Update shape dimensions if icon or size changed
    if (entry.icon !== icon || entry.size !== coords.pixelSize) {
      entry.shape.set(SHAPE_CONFIGS[icon](coords.pixelSize));
      entry.icon = icon;
      entry.size = coords.pixelSize;
    }

    // Update label
    if (entry.label) {
      const fontSize = Math.max(8, coords.pixelSize * 0.6);
      entry.label.set({
        text: String(agent.id),
        fontSize,
        x: -coords.pixelSize,
        y: -fontSize / 2,
        width: coords.pixelSize * 2,
        height: fontSize,
      });
    }
  }

  private _updateAgentPosition(agent: RenderableAgent): void {
    const entry = this._agentShapes.get(agent.id);
    if (!entry) return;
    const coords = this._toCanvasCoords(agent);
    entry.group.set({ x: coords.x, y: coords.y, rotation: coords.rotation });
  }

  private _removeAgent(id: AgentId): void {
    const entry = this._agentShapes.get(id);
    if (entry) {
      entry.shape.off?.();
      entry.group.remove();
      this._agentShapes.delete(id);
    }
    this._removeTrajectory(String(id));
  }

  // -------------------------------------------------------------------------
  // Drag (graph mode)
  // -------------------------------------------------------------------------

  private _attachDrag(group: Group, id: AgentId): void {
    group.on(LeaferDragEvent.START, (e: LeaferDragEvent) => {
      e.stop();
      this._draggingId = id;
      const agent = this._getStoredAgent(id);
      this._cfg.onDragStart(id, agent?.x ?? 0, agent?.y ?? 0);
    });

    group.on(LeaferDragEvent.DRAG, (e: LeaferDragEvent) => {
      if (this._draggingId !== id) return;
      e.stop();
      this._cfg.onDragMove(id, e.moveX, e.moveY);
    });

    group.on(LeaferDragEvent.END, (e: LeaferDragEvent) => {
      if (this._draggingId !== id) return;
      e.stop();
      this._draggingId = null;
      this._cfg.onDragEnd(id);
    });
  }

  // -------------------------------------------------------------------------
  // Trajectory rendering
  // -------------------------------------------------------------------------

  private _updateTrajectory(
    agentId: string,
    points: TrajectoryPoint[],
    color?: string
  ): void {
    const cellSize = this._gridEnv ? this._cellSize() : 1;
    const posDiff = this._gridEnv && this._cfg.coordOffset === 'int' ? cellSize / 2 : 0;
    const trajectoryColor = color ?? 'rgba(66, 133, 244, 0.5)';

    let cached = this._trajectoryCache.get(agentId);

    if (!cached || cached.color !== trajectoryColor) {
      if (cached) cached.group.remove();
      cached = {
        group: new Group({ x: posDiff, y: posDiff }),
        lastRenderedIndex: -1,
        color: trajectoryColor,
      };
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
      const p1 = points[i];
      const p2 = points[i + 1];
      if (p2.time <= startIdx) break;

      const lineColor = p1.color ?? trajectoryColor;
      cached.group.add(
        new Line({
          points: [
            p1.x * cellSize, p1.y * cellSize,
            p2.x * cellSize, p2.y * cellSize,
          ],
          stroke: lineColor,
          strokeWidth: Math.max(1, cellSize * 0.15),
        })
      );
    }

    // Cap segment count to avoid memory bloat
    const maxSegs = points.length - 1;
    const children = cached.group.children;
    if (children.length > maxSegs) {
      const excess = children.length - maxSegs;
      children.slice(0, excess).forEach((c) => cached!.group.remove(c));
    }

    cached.lastRenderedIndex = points[points.length - 1]?.time ?? startIdx;
  }

  private _removeTrajectory(agentId: string): void {
    const cached = this._trajectoryCache.get(agentId);
    if (cached) {
      cached.group.remove();
      this._trajectoryCache.delete(agentId);
    }
  }

  private _rebuildAllTrajectories(): void {
    this._trajectoryCache.forEach((cached) => {
      cached.group.clear();
      cached.lastRenderedIndex = -1;
    });
    this._trajectoryData.forEach((points, agentId) => {
      if (points?.length) {
        const agent = this._cachedAgents.get(agentId as AgentId);
        this._updateTrajectory(agentId, points, agent?.trajectoryColor);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Destroy
  // -------------------------------------------------------------------------

  destroy(): void {
    this._agentShapes.forEach((entry) => {
      entry.shape.off?.();
      entry.group.remove();
    });
    this._agentShapes.clear();
    this._trajectoryCache.forEach((cached) => cached.group.remove());
    this._trajectoryCache.clear();
    super.destroy();
  }
}
