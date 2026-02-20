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
import { EnvironmentView } from '../EnvironmentView';
import { EdgeStorage, EdgeStorageData } from '../storages/EdgeStorage';
import { AgentStorage, RenderableAgent } from '../storages/AgentStorage';
import { AgentLayerConfig } from './AgentLayer';
import { Viewport, AgentId, GraphEdge } from '../types';
import { createArrowhead, createEdgeLine } from '../utils/shape';

// ---------------------------------------------------------------------------
// d3 simulation node type (extends RenderableAgent with d3 fields)
// ---------------------------------------------------------------------------

type SimNode = RenderableAgent & d3.SimulationNodeDatum;
type SimLink = GraphEdge & d3.SimulationLinkDatum<SimNode>;

// ---------------------------------------------------------------------------
// Internal edge shape cache
// ---------------------------------------------------------------------------

interface EdgeShapeEntry {
  line: Line;
  arrowhead: Polygon | null;
  link: SimLink;
}

// ---------------------------------------------------------------------------
// EdgeLayer
// ---------------------------------------------------------------------------

export class EdgeLayer extends BaseLayer {
  readonly defaultZIndex = 20;

  private _simulation: d3.Simulation<SimNode, SimLink> | null = null;
  private _simNodes: SimNode[] = [];
  private _simLinks: SimLink[] = [];
  private _edgeShapes: EdgeShapeEntry[] = [];

  private readonly _agentStorage: AgentStorage;
  private _viewport: Viewport;
  private _ticking = false; // guard against re-entrant flush

  constructor(
    view: EnvironmentView,
    edgeStorage: EdgeStorage,
    agentStorage: AgentStorage
  ) {
    super(view);
    this._agentStorage = agentStorage;
    this._viewport = view.viewport;

    this._initSimulation(edgeStorage.getData().config);

    // Subscribe to both storages
    this.registerStorage(edgeStorage, (data) => this._onEdgeData(data));
    this.registerStorage(agentStorage, () => {
      if (this._ticking) return; // ignore our own flush writes
      this._onAgentData();
    });

    // Initial render
    this._onEdgeData(edgeStorage.getData());
  }

  // -------------------------------------------------------------------------
  // Public: drag callbacks for AgentLayer
  // -------------------------------------------------------------------------

  /** Returns a partial AgentLayerConfig with drag handlers wired to simulation. */
  buildDragHandlers(): Pick<
    AgentLayerConfig,
    'draggable' | 'onDragStart' | 'onDragMove' | 'onDragEnd'
  > {
    return {
      draggable: true,
      onDragStart: (id, x, y) => this._handleDragStart(id, x, y),
      onDragMove: (id, dx, dy) => this._handleDragMove(id, dx, dy),
      onDragEnd: (id) => this._handleDragEnd(id),
    };
  }

  // -------------------------------------------------------------------------
  // Viewport
  // -------------------------------------------------------------------------

  onViewportChange(viewport: Viewport): void {
    this._viewport = viewport;
    if (this._simulation) {
      this._simulation.force(
        'center',
        d3.forceCenter(viewport.width / 2, viewport.height / 2)
      );
      this._simulation.alpha(0.1).restart();
    }
  }

  // -------------------------------------------------------------------------
  // Storage handlers
  // -------------------------------------------------------------------------

  private _onEdgeData(data: EdgeStorageData): void {
    const { edges, config } = data;
    const agentData = this._agentStorage.getData().agents;

    // Rebuild sim nodes — preserve existing x/y/vx/vy from previous sim
    const prevNodeMap = new Map(this._simNodes.map((n) => [n.id, n]));
    this._simNodes = [...agentData.values()].map((agent) => {
      const prev = prevNodeMap.get(agent.id);
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

    // Assign initial positions for nodes without them
    this._assignInitialPositions(this._simNodes, edges);

    const nodeMap = new Map(this._simNodes.map((n) => [n.id, n]));

    // Build sim links with resolved node references
    this._simLinks = edges.map((e) => ({
      ...e,
      source: nodeMap.get(EdgeStorage.resolveId(e.source)) ?? EdgeStorage.resolveId(e.source),
      target: nodeMap.get(EdgeStorage.resolveId(e.target)) ?? EdgeStorage.resolveId(e.target),
    })) as SimLink[];

    // Update simulation
    if (this._simulation) {
      this._reconfigureSimulation(config);
      this._simulation.nodes(this._simNodes);
      (this._simulation.force('link') as d3.ForceLink<SimNode, SimLink>)
        ?.links(this._simLinks);
      this._simulation.alpha(0.3).restart();
    }

    // Rebuild edge shapes
    this._syncEdgeShapes();
  }

  private _onAgentData(/* data: AgentStorageData */): void {
    // AgentStorage changed externally (e.g. new agents added or positions updated).
    const agentData = this._agentStorage.getData().agents;
    const existingNodeMap = new Map(this._simNodes.map((n) => [n.id, n]));

    const agentIds = [...agentData.keys()];
    const sameSet =
      agentIds.length === this._simNodes.length &&
      agentIds.every((id) => existingNodeMap.has(id));

    if (sameSet) {
      // Fast path: mutate existing SimNode objects in-place so that all
      // _simLinks / _edgeShapes references remain valid.  The simulation
      // dynamics (x/y/vx/vy/fx/fy) are preserved — only visual/app
      // properties are refreshed from the incoming agent data.
      for (const agent of agentData.values()) {
        const node = existingNodeMap.get(agent.id)!;
        const prevX = node.x;
        const prevY = node.y;
        const prevVx = node.vx;
        const prevVy = node.vy;
        const prevFx = node.fx;
        const prevFy = node.fy;
        Object.assign(node, agent);
        node.x = agent.x ?? prevX;
        node.y = agent.y ?? prevY;
        node.vx = prevVx ?? 0;
        node.vy = prevVy ?? 0;
        node.fx = prevFx ?? null;
        node.fy = prevFy ?? null;
      }
      if (this._simulation) {
        this._simulation.alpha(0.1).restart();
      }
      return;
    }

    // Slow path: agent set changed — rebuild nodes, re-resolve link references,
    // and recreate edge shapes so everything is consistent.
    this._simNodes = [...agentData.values()].map((agent) => {
      const prev = existingNodeMap.get(agent.id);
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

    // Re-resolve _simLinks to point at the new SimNode objects so that both
    // d3 and _tick() see correct positions.
    const nodeMap = new Map(this._simNodes.map((n) => [n.id, n]));
    this._simLinks = this._simLinks.map((link) => {
      const srcId = EdgeStorage.resolveId(link.source as Parameters<typeof EdgeStorage.resolveId>[0]);
      const tgtId = EdgeStorage.resolveId(link.target as Parameters<typeof EdgeStorage.resolveId>[0]);
      return {
        ...link,
        source: nodeMap.get(srcId) ?? link.source,
        target: nodeMap.get(tgtId) ?? link.target,
      };
    }) as SimLink[];

    if (this._simulation) {
      this._simulation.nodes(this._simNodes);
      (this._simulation.force('link') as d3.ForceLink<SimNode, SimLink>)
        ?.links(this._simLinks);
      this._simulation.alpha(0.1).restart();
    }

    // Rebuild canvas shapes so they hold refs to the updated _simLinks.
    this._syncEdgeShapes();
  }

  // -------------------------------------------------------------------------
  // d3 simulation
  // -------------------------------------------------------------------------

  private _initSimulation(
    config: import('../types/env').GraphEnvConfig
  ): void {
    const { width, height } = this._viewport;
    const linkDist = config.linkDistance ?? 80;
    const charge = config.chargeStrength ?? -300;
    const collision = config.collisionRadius ?? 25;
    this._simulation = d3
      .forceSimulation<SimNode>()
      .force(
        'link',
        d3
          .forceLink<SimNode, SimLink>()
          .id((d) => String(d.id))
          .distance(linkDist)
      )
      .force('charge', d3.forceManyBody().strength(charge))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<SimNode>().radius((_d) => collision))
      .on('tick', () => this._tick());
  }

  private _reconfigureSimulation(
    config: import('../types/env').GraphEnvConfig
  ): void {
    if (!this._simulation) return;
    const linkDist = config.linkDistance ?? 80;
    const charge = config.chargeStrength ?? -300;
    const collision = config.collisionRadius ?? 25;
    (this._simulation.force('link') as d3.ForceLink<SimNode, SimLink>)
      ?.distance(linkDist);
    (this._simulation.force('charge') as d3.ForceManyBody<SimNode>)
      ?.strength(charge);
    (this._simulation.force('collision') as d3.ForceCollide<SimNode>)
      ?.radius((_d) => collision);
  }

  // -------------------------------------------------------------------------
  // Simulation tick
  // -------------------------------------------------------------------------

  private _tick(): void {
    this._ticking = true;

    // 1. Update edge shapes
    this._edgeShapes.forEach(({ line, arrowhead, link }) => {
      const src = link.source as SimNode;
      const tgt = link.target as SimNode;
      if (src.x == null || src.y == null || tgt.x == null || tgt.y == null)
        return;

      const dx = tgt.x - src.x;
      const dy = tgt.y - src.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const srcR = (src.size ?? 20) / 2;
      const tgtR = (tgt.size ?? 20) / 2;

      const x1 = src.x + (dx / dist) * srcR;
      const y1 = src.y + (dy / dist) * srcR;
      const x2 = tgt.x - (dx / dist) * tgtR;
      const y2 = tgt.y - (dy / dist) * tgtR;

      line.set({ points: [x1, y1, x2, y2] });

      if (arrowhead) {
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        arrowhead.set({ x: x2, y: y2, rotation: angle });
      }
    });

    // 2. Push positions back to AgentStorage
    const positions: Map<AgentId, { x: number; y: number; vx?: number; vy?: number }> =
      new Map();
    this._simNodes.forEach((node) => {
      if (node.x != null && node.y != null) {
        positions.set(node.id, { x: node.x, y: node.y, vx: node.vx, vy: node.vy });
      }
    });
    this._agentStorage.mergePositions(positions);
    this._agentStorage.flushPositions();

    this._ticking = false;
  }

  // -------------------------------------------------------------------------
  // Edge shape sync
  // -------------------------------------------------------------------------

  private _syncEdgeShapes(): void {
    // Remove all old shapes
    this._edgeShapes.forEach(({ line, arrowhead }) => {
      this.group.remove(line);
      if (arrowhead) this.group.remove(arrowhead);
    });
    this._edgeShapes = [];

    this._simLinks.forEach((link) => {
      const color = (link as GraphEdge).color ?? '#999999';
      const width = (link as GraphEdge).width ?? 1;
      const style = (link as GraphEdge).style;

      const line = createEdgeLine(color, width, style);
      this.group.add(line);

      let arrowhead: Polygon | null = null;
      if ((link as GraphEdge).directed) {
        arrowhead = createArrowhead(color);
        this.group.add(arrowhead);
      }

      this._edgeShapes.push({ line, arrowhead, link });
    });
  }

  // -------------------------------------------------------------------------
  // Connected components + initial positions
  // -------------------------------------------------------------------------

  private _assignInitialPositions(nodes: SimNode[], edges: GraphEdge[]): void {
    const components = this._findComponents(nodes, edges);

    if (components.length <= 1) {
      // Single component — scatter around center
      nodes.forEach((node) => {
        if (node.x == null || node.y == null) {
          const { width, height } = this._viewport;
          node.x = width / 2 + (Math.random() - 0.5) * 200;
          node.y = height / 2 + (Math.random() - 0.5) * 200;
        }
      });
      return;
    }

    // Multiple components — arrange in a grid
    const spacing = 120;
    const cols = Math.ceil(Math.sqrt(components.length));
    const { width, height } = this._viewport;
    const cellW = (width - spacing) / cols;
    const cellH = (height - spacing) / Math.ceil(components.length / cols);

    components.forEach((comp, idx) => {
      const cx = spacing / 2 + (idx % cols) * cellW + cellW / 2;
      const cy = spacing / 2 + Math.floor(idx / cols) * cellH + cellH / 2;
      const r = Math.min(cellW, cellH) / 4;
      comp.forEach((node) => {
        if (node.x == null || node.y == null) {
          const a = Math.random() * 2 * Math.PI;
          node.x = cx + Math.cos(a) * Math.random() * r;
          node.y = cy + Math.sin(a) * Math.random() * r;
        }
      });
    });
  }

  private _findComponents(nodes: SimNode[], edges: GraphEdge[]): SimNode[][] {
    const visited = new Set<AgentId>();
    const components: SimNode[][] = [];

    const dfs = (id: AgentId, comp: SimNode[]) => {
      if (visited.has(id)) return;
      visited.add(id);
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      comp.push(node);
      edges.forEach((e) => {
        const src = EdgeStorage.resolveId(e.source);
        const tgt = EdgeStorage.resolveId(e.target);
        const next = src === id ? tgt : tgt === id ? src : null;
        if (next !== null && !visited.has(next)) dfs(next, comp);
      });
    };

    nodes.forEach((node) => {
      if (!visited.has(node.id)) {
        const comp: SimNode[] = [];
        dfs(node.id, comp);
        if (comp.length) components.push(comp);
      }
    });

    return components;
  }

  // -------------------------------------------------------------------------
  // Drag handlers (provided to AgentLayer)
  // -------------------------------------------------------------------------

  private _dragPinned: Map<AgentId, { fx: number; fy: number }> = new Map();

  private _handleDragStart(id: AgentId, _x: number, _y: number): void {
    const node = this._simNodes.find((n) => n.id === id);
    if (node) {
      node.fx = node.x ?? 0;
      node.fy = node.y ?? 0;
      this._dragPinned.set(id, { fx: node.fx, fy: node.fy });
      this._agentStorage.setAgentFixed(id, node.fx, node.fy);
      this._simulation?.alphaTarget(0.3).restart();
    }
  }

  private _handleDragMove(id: AgentId, dx: number, dy: number): void {
    const node = this._simNodes.find((n) => n.id === id);
    const pinned = this._dragPinned.get(id);
    if (node && pinned) {
      pinned.fx += dx;
      pinned.fy += dy;
      node.fx = pinned.fx;
      node.fy = pinned.fy;
      this._agentStorage.setAgentFixed(id, pinned.fx, pinned.fy);
    }
  }

  private _handleDragEnd(id: AgentId): void {
    const node = this._simNodes.find((n) => n.id === id);
    if (node) {
      node.fx = null;
      node.fy = null;
      this._agentStorage.setAgentFixed(id, null, null);
    }
    this._dragPinned.delete(id);
    this._simulation?.alphaTarget(0);
  }

  // -------------------------------------------------------------------------
  // Destroy
  // -------------------------------------------------------------------------

  destroy(): void {
    if (this._simulation) {
      this._simulation.stop();
      this._simulation.on('tick', null);
      this._simulation = null;
    }
    this._edgeShapes = [];
    this._simNodes = [];
    this._simLinks = [];
    super.destroy();
  }
}
