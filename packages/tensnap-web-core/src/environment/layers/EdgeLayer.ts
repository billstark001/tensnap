/**
 * environment/layers/EdgeLayer.ts
 *
 * Renders graph edges and drives d3-force layout.
 *
 * Data flow:
 *   1. EdgeStorage / AgentStorage change → rebuild simulation nodes + edge shapes.
 *   2. d3 simulation tick fires:
 *      a. EdgeLayer updates edge Line/Polygon positions directly.
 *      b. Pushes computed node positions back to AgentStorage (silent write).
 *      c. Calls AgentStorage.flushPositions() → AgentLayer re-draws nodes.
 *
 * Drag lifecycle (provided to AgentLayer via config.onDragStart / Move / End):
 *   - onDragStart: pin the d3 node at its current position, reheat simulation.
 *   - onDragMove:  update the pinned fx/fy by accumulated delta.
 *   - onDragEnd:   un-pin the node, cool simulation.
 *
 * Default z-index: 20 (edges render behind agents at z=30).
 *
 * Registered storages:
 *   - EdgeStorage   (required)
 *   - AgentStorage  (required) — read for initial positions; write-back on tick
 */

import * as d3 from 'd3';
import { Line, Polygon } from 'leafer-ui';
import { BaseLayer } from './BaseLayer';
import { EnvironmentView, EnvironmentViewFitMode } from '../EnvironmentView';
import { EdgeDelta, EdgeStorage, EdgeStorageData } from '../storages/EdgeStorage';
import { AgentStorage, RenderableAgent } from '../storages/AgentStorage';
import { AgentLayerConfig } from './AgentLayer';
import { Viewport, AgentId, GraphEdge } from '../types';
import { GraphEnvConfig } from '../types/env';
import { createArrowhead, createEdgeLine } from '../utils/shape';

// #region Types & Constants

type SimNode = RenderableAgent & d3.SimulationNodeDatum;
type SimLink = GraphEdge & d3.SimulationLinkDatum<SimNode>;

interface EdgeShapeEntry {
  line: Line;
  arrowhead: Polygon | null;
  /** Reference to the SimLink whose d3-resolved source/target we read in _tick(). */
  link: SimLink;
}

const DEFAULT_GRAPH_CONFIG: Required<GraphEnvConfig> = {
  linkDistance: 4,
  chargeStrength: -2,
  centeringStrength: 0.1,
  collisionRadius: 2,
  maxComponentDistance: 4,
  componentSpacing: 5,
};

// #endregion

export class EdgeLayer extends BaseLayer {
  readonly defaultZIndex = 20;

  // #region Private fields

  private _simulation: d3.Simulation<SimNode, SimLink> | null = null;
  private _simNodes: SimNode[] = [];
  private _simLinks: SimLink[] = [];
  /** O(1) SimNode lookup by agent id. Kept in sync with _simNodes. */
  private _simNodeMap = new Map<AgentId, SimNode>();
  /** O(1) SimLink lookup by canonical edge key. */
  private _simLinkMap = new Map<string, SimLink>();
  /** O(1) EdgeShapeEntry lookup by canonical edge key. */
  private _edgeShapeMap = new Map<string, EdgeShapeEntry>();
  private _simConfig: Required<GraphEnvConfig>;

  private readonly _agentStorage: AgentStorage;
  private _ticking = false;
  private _dragPinned = new Map<AgentId, { fx: number; fy: number }>();

  // #endregion

  // #region Constructor

  constructor(
    view: EnvironmentView,
    edgeStorage: EdgeStorage,
    agentStorage: AgentStorage,
    config: GraphEnvConfig = {}
  ) {
    super(view);
    this._agentStorage = agentStorage;
    this._simConfig = { ...DEFAULT_GRAPH_CONFIG, ...config };

    this._initSimulation();
    this.registerStorage(edgeStorage, (data, delta) => this._onEdgeData(data, delta));
    this.registerStorage(agentStorage, (_data, delta) => { if (!this._ticking && !delta?.positionsFlushed) this._onAgentData(); });
    this._onEdgeData(edgeStorage.getData());
  }

  // #endregion

  // #region Public API

  /** Update d3-force parameters at runtime and reheat the simulation. */
  setSimConfig(config: GraphEnvConfig): void {
    this._simConfig = { ...DEFAULT_GRAPH_CONFIG, ...config };
    this._reconfigureSimulation();
    this._simulation?.alpha(0.3).restart();
  }

  /** Returns partial AgentLayerConfig with drag handlers wired to the simulation. */
  buildDragHandlers(): Pick<AgentLayerConfig, 'draggable' | 'onDragStart' | 'onDragMove' | 'onDragEnd'> {
    return {
      draggable: true,
      onDragStart: (id, x, y) => this._handleDragStart(id, x, y),
      onDragMove: (id, dx, dy) => this._handleDragMove(id, dx, dy),
      onDragEnd: (id) => this._handleDragEnd(id),
    };
  }

  // #endregion

  // #region Viewport

  onViewportChange(viewport: Viewport, fitMode: EnvironmentViewFitMode): void {
    this.applyViewportTransform(viewport, fitMode);
    this._simulation?.alpha(0.05).restart();
  }

  // #endregion

  // #region Storage handlers

  private _onEdgeData(data: EdgeStorageData, delta?: EdgeDelta): void {
    if ((delta ?? { replaced: true }).replaced) {
      this._fullEdgeRebuild(data.edges);
      return;
    }

    const { added = [], updated = [], removed = [] } = delta!;

    for (const edge of removed) {
      const key = this._edgeKey(edge);
      this._removeEdgeShape(key);
      this._simLinkMap.delete(key);
    }
    if (removed.length) this._syncLinkForce();

    for (const edge of added) {
      const key = this._edgeKey(edge);
      const link = this._buildSimLink(edge, this._simNodeMap);
      this._simLinkMap.set(key, link);
      this._addEdgeShape(key, link);
    }
    for (const edge of updated) {
      const key = this._edgeKey(edge);
      const link = this._simLinkMap.get(key);
      if (link) {
        Object.assign(link, edge);
      }
    }
    if (added.length || updated.length) {
      this._syncLinkForce();
      this._simulation?.alpha(0.1).restart();
    }
  }

  private _fullEdgeRebuild(edges: ReadonlyMap<string, GraphEdge>): void {
    this._rebuildSimNodes(this._agentStorage.getData().agents);
    this._assignInitialPositions(this._simNodes, edges);
    this._pushSimPositions();

    this._simLinkMap.clear();
    for (const edge of edges.values()) {
      this._simLinkMap.set(this._edgeKey(edge), this._buildSimLink(edge, this._simNodeMap));
    }

    this._syncLinkForce();
    this._reconfigureSimulation();
    this._simulation?.nodes(this._simNodes).alpha(0.3).restart();
    this._rebuildAllEdgeShapes();
  }

  private _onAgentData(): void {
    const agents = this._agentStorage.getData().agents;
    const sameSet = agents.size === this._simNodes.length &&
      [...agents.keys()].every(id => this._simNodeMap.has(id));

    if (sameSet) {
      // Fast path: refresh non-simulation fields in-place; preserve dynamics.
      for (const agent of agents.values()) {
        const node = this._simNodeMap.get(agent.id)!;
        const { x, y, vx, vy, fx, fy } = node;
        Object.assign(node, agent);
        node.x = agent.x ?? x; node.y = agent.y ?? y;
        node.vx = vx ?? 0; node.vy = vy ?? 0;
        node.fx = fx ?? null; node.fy = fy ?? null;
      }
    } else {
      // Slow path: rebuild node set; patch existing SimLink references in-place.
      this._rebuildSimNodes(agents);
      // Assign initial positions to new nodes before pushing them back, to prevent
      // a one-frame flicker where AgentLayer renders all agents at (0, 0).
      this._assignInitialPositions(this._simNodes, this._simLinkMap as ReadonlyMap<string, GraphEdge>);
      for (const link of this._simLinks) {
        const srcId = EdgeStorage.resolveId(link.source as Parameters<typeof EdgeStorage.resolveId>[0]);
        const tgtId = EdgeStorage.resolveId(link.target as Parameters<typeof EdgeStorage.resolveId>[0]);
        link.source = this._simNodeMap.get(srcId) ?? link.source;
        link.target = this._simNodeMap.get(tgtId) ?? link.target;
      }
      this._simulation?.nodes(this._simNodes);
      this._syncLinkForce();
      // Push positions synchronously so AgentLayer updates before the browser paints.
      this._pushSimPositions();
    }

    this._simulation?.alpha(0.1).restart();
  }

  // #endregion

  // #region Simulation

  private get _linkForce(): d3.ForceLink<SimNode, SimLink> | undefined {
    return this._simulation?.force<d3.ForceLink<SimNode, SimLink>>('link');
  }

  private _initSimulation(): void {
    const { linkDistance, chargeStrength, collisionRadius, centeringStrength } = this._simConfig;
    this._simulation = d3
      .forceSimulation<SimNode>()
      .force('link', d3.forceLink<SimNode, SimLink>().id(d => String(d.id)).distance(linkDistance))
      .force('charge', d3.forceManyBody<SimNode>().strength(chargeStrength))
      .force('x', d3.forceX<SimNode>(0).strength(centeringStrength))
      .force('y', d3.forceY<SimNode>(0).strength(centeringStrength))
      .force('collision', d3.forceCollide<SimNode>().radius(collisionRadius))
      .on('tick', () => this._tick());
  }

  private _reconfigureSimulation(): void {
    const { linkDistance, chargeStrength, collisionRadius, centeringStrength } = this._simConfig;
    this._linkForce?.distance(linkDistance);
    (this._simulation?.force('charge') as d3.ForceManyBody<SimNode>)?.strength(chargeStrength);
    (this._simulation?.force('collision') as d3.ForceCollide<SimNode>)?.radius(collisionRadius);
    (this._simulation?.force('x') as d3.ForceX<SimNode>)?.strength(centeringStrength);
    (this._simulation?.force('y') as d3.ForceY<SimNode>)?.strength(centeringStrength);
  }

  /** Rebuild _simLinks from _simLinkMap and push to the link force. */
  private _syncLinkForce(): void {
    this._simLinks = [...this._simLinkMap.values()];
    this._linkForce?.links(this._simLinks);
  }

  // #endregion

  // #region Tick

  /**
   * Write current SimNode positions back to AgentStorage immediately.
   * Calling `flushPositions()` causes AgentLayer to update group coordinates
   * in the same synchronous call stack, before the browser paints — eliminating
   * the one-frame flicker where all agents appear at (0, 0).
   */
  private _pushSimPositions(): void {
    const positions = new Map<AgentId, { x: number; y: number; vx?: number; vy?: number }>();
    for (const n of this._simNodes) {
      if (n.x != null && n.y != null) {
        positions.set(n.id, { x: n.x, y: n.y, vx: n.vx ?? 0, vy: n.vy ?? 0 });
      }
    }
    if (positions.size > 0) {
      this._agentStorage.mergePositions(positions);
      this._agentStorage.flushPositions();
    }
  }

  private _tick(): void {
    this._ticking = true;

    this._edgeShapeMap.forEach(({ line, arrowhead, link }) => {
      const src = link.source as SimNode;
      const tgt = link.target as SimNode;
      if (src.x == null || src.y == null || tgt.x == null || tgt.y == null) return;

      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const dist = Math.hypot(dx, dy) || 1;
      const x1 = src.x + (dx / dist) * ((src.size ?? 1) / 2);
      const y1 = src.y + (dy / dist) * ((src.size ?? 1) / 2);
      const x2 = tgt.x - (dx / dist) * ((tgt.size ?? 1) / 2);
      const y2 = tgt.y - (dy / dist) * ((tgt.size ?? 1) / 2);

      line.set({ points: [x1, y1, x2, y2] });
      if (arrowhead) arrowhead.set({ x: x2, y: y2, rotation: Math.atan2(dy, dx) * 180 / Math.PI });
    });

    const positions = new Map<AgentId, { x: number; y: number; vx?: number; vy?: number }>();
    for (const n of this._simNodes) {
      if (n.x != null && n.y != null) positions.set(n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy });
    }
    this._agentStorage.mergePositions(positions);
    this._agentStorage.flushPositions();

    this._ticking = false;
  }

  // #endregion

  // #region Edge shapes

  private _addEdgeShape(key: string, link: SimLink): void {
    const { color = '#999999', width = 0.2, style, directed } = link as GraphEdge;
    const line = createEdgeLine(color, width, style);
    this.group.add(line);
    let arrowhead: Polygon | null = null;
    if (directed) {
      arrowhead = createArrowhead(color);
      this.group.add(arrowhead);
    }
    this._edgeShapeMap.set(key, { line, arrowhead, link });
  }

  private _removeEdgeShape(key: string): void {
    const entry = this._edgeShapeMap.get(key);
    if (!entry) return;
    this.group.remove(entry.line);
    if (entry.arrowhead) this.group.remove(entry.arrowhead);
    this._edgeShapeMap.delete(key);
  }

  private _rebuildAllEdgeShapes(): void {
    for (const { line, arrowhead } of this._edgeShapeMap.values()) {
      this.group.remove(line);
      if (arrowhead) this.group.remove(arrowhead);
    }
    this._edgeShapeMap.clear();
    for (const [key, link] of this._simLinkMap) this._addEdgeShape(key, link);
  }

  // #endregion

  // #region Node helpers

  /** Canonical edge key derived from a raw GraphEdge. */
  private _edgeKey(edge: GraphEdge): string {
    return EdgeStorage.edgeKey(
      EdgeStorage.resolveId(edge.source),
      EdgeStorage.resolveId(edge.target)
    );
  }

  /** Build a SimLink, resolving source/target ids to SimNode objects where available. */
  private _buildSimLink(edge: GraphEdge, nodeMap: Map<AgentId, SimNode>): SimLink {
    const src = EdgeStorage.resolveId(edge.source);
    const tgt = EdgeStorage.resolveId(edge.target);
    return { ...edge, source: nodeMap.get(src) ?? src, target: nodeMap.get(tgt) ?? tgt } as SimLink;
  }

  /**
   * Rebuild _simNodes and _simNodeMap from an agent map,
   * preserving existing simulation dynamics (x/y/vx/vy/fx/fy) where possible.
   */
  private _rebuildSimNodes(agents: ReadonlyMap<AgentId, RenderableAgent>): void {
    this._simNodes = [...agents.values()].map(agent => {
      const prev = this._simNodeMap.get(agent.id);
      return {
        ...agent,
        x: prev?.x ?? agent.x,
        y: prev?.y ?? agent.y,
        vx: prev?.vx ?? 0,
        vy: prev?.vy ?? 0,
        fx: prev?.fx ?? null,
        fy: prev?.fy ?? null,
      } as SimNode;
    });
    this._simNodeMap = new Map(this._simNodes.map(n => [n.id, n]));
  }

  // #endregion

  // #region Initial positions

  private _assignInitialPositions(nodes: SimNode[], edges: ReadonlyMap<string, GraphEdge>): void {
    const components = this._findComponents(nodes, edges);
    const scatter = this._simConfig.linkDistance * 3;

    if (components.length <= 1) {
      nodes.forEach(n => {
        if (n.x == null || n.y == null) {
          n.x = (Math.random() - 0.5) * scatter * 2;
          n.y = (Math.random() - 0.5) * scatter * 2;
        }
      });
      return;
    }

    const cellSize = Math.max(scatter, this._simConfig.maxComponentDistance) + this._simConfig.componentSpacing;
    const cols = Math.ceil(Math.sqrt(components.length));
    const gridW = cols * cellSize;
    const gridH = Math.ceil(components.length / cols) * cellSize;

    components.forEach((comp, idx) => {
      const cx = -gridW / 2 + (idx % cols) * cellSize + cellSize / 2;
      const cy = -gridH / 2 + Math.floor(idx / cols) * cellSize + cellSize / 2;
      const r = cellSize / 4;
      comp.forEach(n => {
        if (n.x == null || n.y == null) {
          const a = Math.random() * 2 * Math.PI;
          n.x = cx + Math.cos(a) * Math.random() * r;
          n.y = cy + Math.sin(a) * Math.random() * r;
        }
      });
    });
  }

  /**
   * Iterative DFS — avoids call-stack overflow on large graphs.
   * Relies on _simNodeMap being current at call time.
   */
  private _findComponents(nodes: SimNode[], edges: ReadonlyMap<string, GraphEdge>): SimNode[][] {
    const visited = new Set<AgentId>();
    const components: SimNode[][] = [];

    // Build undirected adjacency list in one O(E) pass.
    const adj = new Map<AgentId, AgentId[]>(nodes.map(n => [n.id, []]));
    for (const e of edges.values()) {
      const src = EdgeStorage.resolveId(e.source);
      const tgt = EdgeStorage.resolveId(e.target);
      adj.get(src)?.push(tgt);
      adj.get(tgt)?.push(src);
    }

    for (const node of nodes) {
      if (visited.has(node.id)) continue;
      const comp: SimNode[] = [];
      const stack = [node.id];
      while (stack.length) {
        const id = stack.pop()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const n = this._simNodeMap.get(id);
        if (n) comp.push(n);
        for (const neighbor of (adj.get(id) ?? [])) {
          if (!visited.has(neighbor)) stack.push(neighbor);
        }
      }
      if (comp.length) components.push(comp);
    }

    return components;
  }

  // #endregion

  // #region Drag handlers

  private _handleDragStart(id: AgentId, _x: number, _y: number): void {
    const node = this._simNodeMap.get(id);
    if (!node) return;
    node.fx = node.x ?? 0;
    node.fy = node.y ?? 0;
    this._dragPinned.set(id, { fx: node.fx, fy: node.fy });
    this._agentStorage.setAgentFixed(id, node.fx, node.fy);
    this._simulation?.alphaTarget(0.3).restart();
  }

  private _handleDragMove(id: AgentId, dx: number, dy: number): void {
    const node = this._simNodeMap.get(id);
    const pinned = this._dragPinned.get(id);
    if (!node || !pinned) return;
    pinned.fx += dx;
    pinned.fy += dy;
    node.fx = pinned.fx;
    node.fy = pinned.fy;
    this._agentStorage.setAgentFixed(id, pinned.fx, pinned.fy);
  }

  private _handleDragEnd(id: AgentId): void {
    const node = this._simNodeMap.get(id);
    if (node) {
      node.fx = null;
      node.fy = null;
      this._agentStorage.setAgentFixed(id, null, null);
    }
    this._dragPinned.delete(id);
    this._simulation?.alphaTarget(0);
  }

  // #endregion

  // #region Destroy

  destroy(): void {
    this._simulation?.stop().on('tick', null);
    this._simulation = null;
    for (const { line, arrowhead } of this._edgeShapeMap.values()) {
      this.group.remove(line);
      if (arrowhead) this.group.remove(arrowhead);
    }
    this._edgeShapeMap.clear();
    this._simLinkMap.clear();
    this._simNodeMap.clear();
    this._simNodes = [];
    this._simLinks = [];
    super.destroy();
  }

  // #endregion
}