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
  Ellipse,
  Group,
  UI,
  Text,
  PointerEvent as LeaferPointerEvent,
  DragEvent as LeaferDragEvent,
} from '@leafer-ui/core';
import { BaseLayer } from './BaseLayer';
import type { EnvironmentViewFitMode } from '../host';
import {
  AgentDelta,
  AgentStorage,
  AgentStorageData,
  AgentRenderState,
} from '../storages/AgentStorage';
import {
  Viewport,
  GridCoordOffset,
  SceneBounds,
  OriginMode,
  getAssetIdFromIcon,
  IBoundedLayer,
  isBuiltinAgentIcon,
} from '../types';
import type { AgentIcon, AgentId, BuiltinAgentIcon } from '@tensnap/protocol/layers';
import { getCoordOffsetValue } from '../utils';
import { SHAPE_CONFIGS, SHAPE_CLASSES, createAgentLabel } from '../utils/shape';

// #region Constants & Defaults

const DEFAULT_AGENT_COLOR = '#69b3a2';
const INSPECTION_HIGHLIGHT_COLOR = '#facc15';
const INSPECTION_HIGHLIGHT_INNER_RADIUS = 0.82;
const INSPECTION_HIGHLIGHT_Z_INDEX = 1_000;
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
  /** Resolve an asset-id to URL for `asset:<id>` icons. */
  resolveAssetUrl?: (assetId: string) => string | null | undefined;
  /** Draw a non-mutating inspection highlight around this agent id. */
  highlightedAgentId?: AgentId;

  onAgentClick?: (agent: AgentRenderState, event: any) => void;
  onAgentContextMenu?: (agent: AgentRenderState, event: any) => void;
  onAgentDoubleClick?: (agent: AgentRenderState) => void;
  onDragStart?: (id: AgentId, x: number, y: number) => void;
  onDragMove?: (id: AgentId, dx: number, dy: number) => void;
  onDragEnd?: (id: AgentId) => void;
}

type ResolvedConfig = Required<Omit<AgentLayerConfig, 'sceneBounds' | 'highlightedAgentId'>> & {
  sceneBounds?: SceneBounds;
  highlightedAgentId?: AgentId;
};

interface AgentShapeEntry {
  group: Group;
  shape: UI;
  highlight: UI | null;
  label: Text | null;
  icon: AgentIcon;
  assetUrl: string | null;
  size: number;
  color: string;
}

export class AgentLayer extends BaseLayer implements IBoundedLayer {
  readonly defaultZIndex = 40;

  // #region Private fields

  private readonly _agentsGroup = new Group();
  private readonly _agentShapes = new Map<AgentId, AgentShapeEntry>();
  private readonly _cfg: ResolvedConfig;

  private _cachedAgents = new Map<AgentId, AgentRenderState>();
  private _draggingId: AgentId | null = null;

  // #endregion

  // #region Constructor

  constructor(
    agentStorage: AgentStorage,
    config: AgentLayerConfig = {},
  ) {
    super();

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
      resolveAssetUrl: () => null,
      ...config,
      sceneBounds: undefined,
    };

    if (config.sceneBounds) {
      this.setSceneBounds(config.sceneBounds);
    }

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

  setSceneBounds(bounds: SceneBounds | Partial<Viewport>): void {
    if ('width' in bounds || 'height' in bounds) {
      const { x = 0, y = 0, width = 1, height = 1 } = bounds;
      this._cfg.sceneBounds = {
        minX: x,
        maxX: x + width,
        minY: y,
        maxY: y + height,
      };
    } else {
      this._cfg.sceneBounds = { ...bounds as SceneBounds };
    }
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

  onViewportChange(viewport: Viewport, fitMode: EnvironmentViewFitMode): void {
    this.applyViewportTransform(viewport, fitMode);
  }

  // #endregion

  // #region Data

  private _onAgentData(data: AgentStorageData, delta: AgentDelta = { replaced: true }): void {
    this._cachedAgents = data.agents;

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
  }

  /**
   * Tight loop that only updates group x/y/rotation from agent positions.
   * Called every d3-force tick via `flushPositions()`.
   * Avoids all color/icon/size checks, trajectory syncing, and GC-heavy operations.
   */
  private _flushPositionsOnly(agents: Map<AgentId, AgentRenderState>): void {
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
    return getCoordOffsetValue(this._cfg.coordOffset);
  }

  private _toSceneCoords(agent: AgentRenderState) {
    const off = this._posOffset;
    return {
      x: (agent.x ?? 0) + off,
      y: (agent.y ?? 0) + off,
      rotation: agent.heading ? (agent.heading * 180) / Math.PI : 0,
      size: agent.size ?? 1,
    };
  }

  private _createAgent(agent: AgentRenderState): void {
    const coords = this._toSceneCoords(agent);
    const icon = agent.icon ?? 'circle';
    const color = agent.color ?? DEFAULT_AGENT_COLOR;
    const assetUrl = this._resolveIconAssetUrl(icon);

    const shape: UI = this._createShape(icon, coords.size, color, assetUrl);
    const label = this._cfg.showLabel ? createAgentLabel(agent.id, coords.size) : null;
    const group = new Group({ x: coords.x, y: coords.y, rotation: coords.rotation });
    const highlight = this._createInspectionHighlight(agent.id, coords.size);

    group.add(shape);
    if (label) group.add(label);
    if (highlight) {
      group.add(highlight);
      group.set({ zIndex: INSPECTION_HIGHLIGHT_Z_INDEX });
    }

    this._bindEvents(shape, group, agent.id);
    this._agentsGroup.add(group);
    this._agentShapes.set(agent.id, { group, shape, highlight, label, icon, assetUrl, size: coords.size, color });
  }

  /** Merged shape-appearance + position update (the two are always applied together). */
  private _updateAgent(agent: AgentRenderState): void {
    const entry = this._agentShapes.get(agent.id);
    if (!entry) return;

    const coords = this._toSceneCoords(agent);
    const icon = agent.icon ?? 'circle';
    const color = agent.color ?? DEFAULT_AGENT_COLOR;
    const assetUrl = this._resolveIconAssetUrl(icon);

    const shapeTypeChanged = entry.icon !== icon || entry.assetUrl !== assetUrl;
    if (shapeTypeChanged) {
      const nextShape = this._createShape(icon, coords.size, color, assetUrl);
      entry.group.remove(entry.shape);
      entry.shape.off?.();
      entry.shape = nextShape;
      entry.group.addAt(nextShape, 0);
      this._bindEvents(nextShape, entry.group, agent.id);
      entry.icon = icon;
      entry.assetUrl = assetUrl;
      entry.size = coords.size;
      entry.color = color;
    } else {
      // Batch shape appearance changes into a single set() call.
      const shapeUpdates: Record<string, unknown> = {};
      if (entry.size !== coords.size) {
        if (isBuiltinAgentIcon(icon)) {
          Object.assign(shapeUpdates, SHAPE_CONFIGS[icon](coords.size));
        } else {
          Object.assign(shapeUpdates, SHAPE_CONFIGS.square(coords.size));
        }
        entry.size = coords.size;
      }
      if (entry.color !== color) {
        if (entry.assetUrl) {
          shapeUpdates.fill = {
            type: 'image',
            mode: 'cover',
            url: entry.assetUrl,
          };
        } else {
          shapeUpdates.fill = color;
        }
        entry.color = color;
      }
      if (Object.keys(shapeUpdates).length) entry.shape.set(shapeUpdates);
    }

    this._updateInspectionHighlight(entry, agent.id, coords.size);

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

  private _resolveIconAssetUrl(icon: AgentIcon | undefined): string | null {
    const assetId = getAssetIdFromIcon(icon);
    if (!assetId) {
      return null;
    }
    return this._cfg.resolveAssetUrl(assetId) ?? null;
  }

  private _createShape(icon: AgentIcon, size: number, color: string, assetUrl: string | null): UI {
    if (isBuiltinAgentIcon(icon)) {
      const BuiltinShape = SHAPE_CLASSES[icon as BuiltinAgentIcon];
      return new BuiltinShape({
        ...SHAPE_CONFIGS[icon as BuiltinAgentIcon](size),
        fill: color,
      });
    }

    const fill = assetUrl
      ? {
        type: 'image',
        mode: 'cover',
        url: assetUrl,
      }
      : color;

    const Shape = SHAPE_CLASSES.square;
    return new Shape({
      ...SHAPE_CONFIGS.square(size),
      fill,
    });
  }

  /** Keep inspection state separate from agent appearance: asset and color remain meaningful. */
  private _createInspectionHighlight(id: AgentId, size: number): UI | null {
    if (this._cfg.highlightedAgentId !== id) return null;
    const diameter = Math.max(1, size * 1.5);
    // Use a geometric donut instead of a transparent fill. Some Leafer
    // render paths flatten transparent fills into an opaque disk.
    return new Ellipse({
      width: diameter,
      height: diameter,
      x: -diameter / 2,
      y: -diameter / 2,
      innerRadius: INSPECTION_HIGHLIGHT_INNER_RADIUS,
      fill: INSPECTION_HIGHLIGHT_COLOR,
      hitTest: false,
    });
  }

  private _updateInspectionHighlight(entry: AgentShapeEntry, id: AgentId, size: number): void {
    if (this._cfg.highlightedAgentId !== id) return;
    const diameter = Math.max(1, size * 1.5);
    if (!entry.highlight) {
      entry.highlight = this._createInspectionHighlight(id, size);
      if (entry.highlight) entry.group.add(entry.highlight);
    } else {
      entry.highlight.set({
        width: diameter,
        height: diameter,
        x: -diameter / 2,
        y: -diameter / 2,
      });
    }
    // A selected agent stays above siblings even when they are updated later.
    entry.group.set({ zIndex: INSPECTION_HIGHLIGHT_Z_INDEX });
  }

  private _removeAgent(id: AgentId): void {
    const entry = this._agentShapes.get(id);
    if (!entry) return;
    entry.shape.off?.();
    entry.group.off?.();
    entry.group.remove();
    this._agentShapes.delete(id);
  }

  private _clearAgents(): void {
    for (const entry of this._agentShapes.values()) {
      entry.shape.off?.();
      entry.group.off?.();
    }
    this._agentShapes.clear();
    this._agentsGroup.clear();
  }

  // #endregion

  // #region Events

  private _bindEvents(shape: UI, group: Group, id: AgentId): void {
    const cfg = this._cfg;

    if (cfg.clickable) {
      shape.on(LeaferPointerEvent.CLICK, (e: any) => {
        if (!this.interactionEnabled) return;
        const a = this._cachedAgents.get(id);
        if (a) cfg.onAgentClick(a, e);
      });
    }
    if (cfg.contextMenuable) {
      shape.on(LeaferPointerEvent.MENU, (e: any) => {
        if (!this.interactionEnabled) return;
        const a = this._cachedAgents.get(id);
        if (a) cfg.onAgentContextMenu(a, e);
      });
    }
    if (cfg.draggable) this._attachDrag(group, id);

    group.on(LeaferPointerEvent.DOUBLE_TAP, (e: any) => {
      if (!this.interactionEnabled) return;
      e?.stop();
      const a = this._cachedAgents.get(id);
      if (a) cfg.onAgentDoubleClick(a);
    });
  }

  // #endregion

  // #region Drag

  private _attachDrag(group: Group, id: AgentId): void {
    const { onDragStart, onDragMove, onDragEnd } = this._cfg;

    group.on(LeaferDragEvent.START, (e: LeaferDragEvent) => {
      if (!this.interactionEnabled) return;
      e?.stop();
      this._draggingId = id;
      const agent = this._cachedAgents.get(id);
      onDragStart(id, agent?.x ?? 0, agent?.y ?? 0);
    });

    group.on(LeaferDragEvent.DRAG, (e: LeaferDragEvent) => {
      if (!this.interactionEnabled) return;
      if (this._draggingId !== id) return;
      e?.stop();
      onDragMove(id, e.moveX, e.moveY);
    });

    group.on(LeaferDragEvent.END, (e: LeaferDragEvent) => {
      if (!this.interactionEnabled) return;
      if (this._draggingId !== id) return;
      e?.stop();
      this._draggingId = null;
      onDragEnd(id);
    });
  }

  // #endregion

  protected override onInteractionChanged(enabled: boolean): void {
    if (!enabled) {
      this._draggingId = null;
    }
  }

  // #region Destroy

  destroy(): void {
    this._clearAgents();
    super.destroy();
  }

  // #endregion
}
