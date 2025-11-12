import * as d3 from 'd3';
import { GraphAgent } from '@/types/model';

export interface VisualizerConfig {
  width: number;
  height: number;
  padding: number;
  linkDistance: number;
  chargeStrength: number;
  collisionRadius: number;
  maxComponentDistance: number;
  componentSpacing: number;
}

export interface VisualizedGraphAgent extends GraphAgent {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface GraphData {
  nodes: VisualizedGraphAgent[];
  edges: any[];
}

export type NodeClickHandler = (node: VisualizedGraphAgent) => void;

const DEFAULT_CONFIG: VisualizerConfig = {
  width: 600,
  height: 600,
  padding: 50,
  linkDistance: 80,
  chargeStrength: -300,
  collisionRadius: 25,
  maxComponentDistance: 120,
  componentSpacing: 120,
};

export class GraphVisualizer {
  private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private container: d3.Selection<SVGGElement, unknown, null, undefined>;
  private simulation: d3.Simulation<VisualizedGraphAgent, undefined> | null = null;
  private config: VisualizerConfig;
  private nodesData: VisualizedGraphAgent[] = [];
  private edgesData: any[] = [];
  private onNodeDoubleClick: NodeClickHandler | null = null;

  constructor(
    svgElement: SVGSVGElement,
    config: Partial<VisualizerConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.svg = d3.select(svgElement);
    this.container = this.initializeSVG();
    this.initializeSimulation();
  }

  private initializeSVG(): d3.Selection<SVGGElement, unknown, null, undefined> {
    this.svg.selectAll('*').remove();

    // Setup zoom behavior
    this.svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
          this.container.attr('transform', event.transform);
        })
    );

    const container = this.svg.append('g').attr('class', 'graph-container');

    // Arrow marker
    this.svg
      .append('defs')
      .append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 20)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#999');

    container.append('g').attr('class', 'edges');
    container.append('g').attr('class', 'nodes');

    return container;
  }

  private initializeSimulation(): void {
    this.simulation = d3
      .forceSimulation<VisualizedGraphAgent>()
      .force(
        'link',
        d3
          .forceLink<VisualizedGraphAgent, any>()
          .id((d) => String(d.id))
          .distance(this.config.linkDistance)
      )
      .force('charge', d3.forceManyBody().strength(this.config.chargeStrength))
      .force(
        'center',
        d3.forceCenter(this.config.width / 2, this.config.height / 2)
      )
      .force('collision', d3.forceCollide().radius(this.config.collisionRadius));
  }

  private findConnectedComponents(
    nodes: VisualizedGraphAgent[],
    edges: any[]
  ): VisualizedGraphAgent[][] {
    const components: VisualizedGraphAgent[][] = [];
    const visited = new Set<string | number>();

    const dfs = (nodeId: string | number, component: VisualizedGraphAgent[]) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;

      component.push(node);
      edges.forEach((edge) => {
        const sourceId = typeof edge.source === 'object' ? edge.source.id : edge.source;
        const targetId = typeof edge.target === 'object' ? edge.target.id : edge.target;
        const nextId =
          sourceId === nodeId ? targetId : targetId === nodeId ? sourceId : null;
        if (nextId && !visited.has(nextId)) dfs(nextId, component);
      });
    };

    nodes.forEach((node) => {
      if (!visited.has(node.id)) {
        const component: VisualizedGraphAgent[] = [];
        dfs(node.id, component);
        if (component.length > 0) components.push(component);
      }
    });

    return components;
  }

  private arrangeComponentPositions(components: VisualizedGraphAgent[][]): void {
    if (components.length === 1) return;

    const cols = Math.ceil(Math.sqrt(components.length));
    const cellWidth = (this.config.width - this.config.componentSpacing) / cols;
    const cellHeight =
      (this.config.height - this.config.componentSpacing) /
      Math.ceil(components.length / cols);

    components.forEach((component, index) => {
      const centerX =
        this.config.componentSpacing / 2 +
        (index % cols) * cellWidth +
        cellWidth / 2;
      const centerY =
        this.config.componentSpacing / 2 +
        Math.floor(index / cols) * cellHeight +
        cellHeight / 2;
      const radius = Math.min(cellWidth, cellHeight) / 4;

      component.forEach((node) => {
        if (node.x === undefined || node.y === undefined) {
          const angle = Math.random() * 2 * Math.PI;
          node.x = centerX + Math.cos(angle) * Math.random() * radius;
          node.y = centerY + Math.sin(angle) * Math.random() * radius;
        }
      });
    });
  }

  private createComponentConstraintForce(
    components: VisualizedGraphAgent[][]
  ): ((alpha: number) => void) | null {
    if (components.length <= 1) return null;

    return (alpha: number) => {
      const centers = components.map((comp) => ({
        x: d3.mean(comp, (d) => d.x || 0) || 0,
        y: d3.mean(comp, (d) => d.y || 0) || 0,
        component: comp,
      }));

      for (let i = 0; i < centers.length; i++) {
        for (let j = i + 1; j < centers.length; j++) {
          const dx = centers[j].x - centers[i].x;
          const dy = centers[j].y - centers[i].y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance > this.config.maxComponentDistance) {
            const force = (distance - this.config.maxComponentDistance) * alpha * 0.2;
            const fx = (dx / distance) * force;
            const fy = (dy / distance) * force;

            centers[i].component.forEach((node) => {
              node.vx = (node.vx || 0) + fx / centers[i].component.length;
              node.vy = (node.vy || 0) + fy / centers[i].component.length;
            });

            centers[j].component.forEach((node) => {
              node.vx = (node.vx || 0) - fx / centers[j].component.length;
              node.vy = (node.vy || 0) - fy / centers[j].component.length;
            });
          }
        }
      }
    };
  }

  private createDragBehavior() {
    return d3
      .drag<SVGGElement, VisualizedGraphAgent>()
      .on('start', (event, d) => {
        if (!event.active && this.simulation) {
          this.simulation.alphaTarget(0.3).restart();
        }
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active && this.simulation) {
          this.simulation.alphaTarget(0);
        }
        d.fx = null;
        d.fy = null;
      });
  }

  private addNodeShape(
    g: d3.Selection<SVGGElement, any, any, any>,
    d: VisualizedGraphAgent
  ): void {
    const size = d.size || 10;
    switch (d.icon) {
      case 'square':
        g.append('rect')
          .attr('x', -size / 2)
          .attr('y', -size / 2)
          .attr('width', size)
          .attr('height', size);
        break;
      case 'triangle':
        g.append('polygon').attr(
          'points',
          `0,${-size / 2} ${-size / 2},${size / 2} ${size / 2},${size / 2}`
        );
        break;
      default:
        g.append('circle').attr('r', size / 2);
    }
  }

  private getShapeType(icon?: string): string {
    return icon === 'square'
      ? 'rect'
      : icon === 'triangle'
      ? 'polygon'
      : 'circle';
  }

  private updateEdges(edges: any[]): void {
    const linkSelection = this.container
      .select('.edges')
      .selectAll('line')
      .data(
        edges,
        (d: any) => `${d.source.id || d.source}-${d.target.id || d.target}`
      );

    linkSelection.exit().remove();

    const linkMerged = linkSelection.enter().append('line').merge(linkSelection as any);

    linkMerged
      .attr('stroke', (d) => d.color || '#999999')
      .attr('stroke-width', (d) => d.width || 1)
      .attr('stroke-dasharray', (d) =>
        d.style === 'dashed' ? '5,5' : d.style === 'dotted' ? '2,2' : null
      )
      .attr('marker-end', (d) => (d.directed ? 'url(#arrow)' : null));
  }

  private updateNodes(nodes: VisualizedGraphAgent[]): void {
    const nodeSelection = this.container
      .select('.nodes')
      .selectAll('g')
      .data(nodes, (d: any) => d.id);

    nodeSelection.exit().remove();

    const dragBehavior = this.createDragBehavior();

    const nodeEnter = nodeSelection
      .enter()
      .append('g')
      .call(dragBehavior)
      .on('dblclick', (event, d) => {
        event.stopPropagation();
        if (this.onNodeDoubleClick) {
          this.onNodeDoubleClick(d);
        }
      });

    nodeEnter.each((d, i, nodes) => {
      this.addNodeShape(d3.select(nodes[i]), d);
    });

    nodeEnter
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '.35em')
      .style('font-size', '10px')
      .style('fill', 'white')
      .style('pointer-events', 'none');

    const nodeMerged = nodeEnter.merge(nodeSelection as any);

    // Update shapes if icon changed
    nodeMerged.each((d: any, i, nodes) => {
      const g = d3.select(nodes[i]);
      const current = g.select('rect, circle, polygon').node() as Element;
      if (current && current.tagName.toLowerCase() !== this.getShapeType(d.icon)) {
        g.selectAll('rect, circle, polygon').remove();
        this.addNodeShape(g, d);
      }
    });

    nodeMerged
      .selectAll('rect')
      .attr('fill', (d: any) => d.color || '#69b3a2')
      .attr('width', (d: any) => d.size || 10)
      .attr('height', (d: any) => d.size || 10)
      .attr('x', (d: any) => -(d.size || 10) / 2)
      .attr('y', (d: any) => -(d.size || 10) / 2);

    nodeMerged
      .selectAll('circle')
      .attr('fill', (d: any) => d.color || '#69b3a2')
      .attr('r', (d: any) => (d.size || 10) / 2);

    nodeMerged.selectAll('polygon').attr('fill', (d: any) => d.color || '#69b3a2').attr('points', (d: any) => {
      const size = d.size || 10;
      return `0,${-size / 2} ${-size / 2},${size / 2} ${size / 2},${size / 2}`;
    });

    nodeMerged
      .selectAll('text')
      .text((d: any) => String(d.id))
      .style('font-size', (d: any) => `${Math.max(8, (d.size || 10) * 0.6)}px`);
  }

  private setupSimulationTick(): void {
    if (!this.simulation) return;

    this.simulation.on('tick', () => {
      // Update edge positions
      this.container
        .selectAll('.edges line')
        .attr('x1', (d: any) => {
          const dx = d.target.x - d.source.x;
          const dy = d.target.y - d.source.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const nodeRadius = (d.source.size || 10) / 2;
          return d.source.x + (dx / dist) * nodeRadius;
        })
        .attr('y1', (d: any) => {
          const dx = d.target.x - d.source.x;
          const dy = d.target.y - d.source.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const nodeRadius = (d.source.size || 10) / 2;
          return d.source.y + (dy / dist) * nodeRadius;
        })
        .attr('x2', (d: any) => {
          const dx = d.target.x - d.source.x;
          const dy = d.target.y - d.source.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const nodeRadius = (d.target.size || 10) / 2;
          return d.target.x - (dx / dist) * nodeRadius;
        })
        .attr('y2', (d: any) => {
          const dx = d.target.x - d.source.x;
          const dy = d.target.y - d.source.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const nodeRadius = (d.target.size || 10) / 2;
          return d.target.y - (dy / dist) * nodeRadius;
        });

      // Update node positions
      this.container
        .selectAll('.nodes g')
        .attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });
  }

  public fitViewToGraph(duration: number = 750): void {
    if (this.nodesData.length === 0) return;

    const bounds = {
      minX: d3.min(this.nodesData, (d) => d.x || 0) || 0,
      maxX: d3.max(this.nodesData, (d) => d.x || 0) || 0,
      minY: d3.min(this.nodesData, (d) => d.y || 0) || 0,
      maxY: d3.max(this.nodesData, (d) => d.y || 0) || 0,
    };

    const graphWidth = bounds.maxX - bounds.minX + 2 * this.config.padding;
    const graphHeight = bounds.maxY - bounds.minY + 2 * this.config.padding;
    const scale = Math.min(
      this.config.width / graphWidth,
      this.config.height / graphHeight,
      1
    );
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    this.container
      .transition()
      .duration(duration)
      .attr(
        'transform',
        `translate(${this.config.width / 2 - centerX * scale},${
          this.config.height / 2 - centerY * scale
        }) scale(${scale})`
      );
  }

  public setNodeClickHandler(handler: NodeClickHandler): void {
    this.onNodeDoubleClick = handler;
  }

  public update(data: GraphData, shouldReinitializePositions: boolean = false): void {
    // Prepare nodes with preserved positions
    const simulationNodes: VisualizedGraphAgent[] = data.nodes.map((node) => {
      const existing = this.nodesData.find((n) => n.id === node.id);
      return {
        ...node,
        x: existing?.x ?? node.x,
        y: existing?.y ?? node.y,
        vx: existing?.vx ?? 0,
        vy: existing?.vy ?? 0,
        fx: existing?.fx ?? null,
        fy: existing?.fy ?? null,
      };
    });

    // Prepare edges
    const nodeMap = new Map(simulationNodes.map((n) => [n.id, n]));
    const simulationEdges = data.edges.map((edge) => ({
      ...edge,
      source: nodeMap.get(edge.source),
      target: nodeMap.get(edge.target),
    }));

    // Find connected components
    const components = this.findConnectedComponents(
      simulationNodes,
      simulationEdges
    );

    // Initialize positions if needed
    if (
      shouldReinitializePositions ||
      simulationNodes.some((n) => n.x === undefined || n.y === undefined)
    ) {
      if (components.length > 1) {
        this.arrangeComponentPositions(components);
      } else {
        simulationNodes.forEach((node) => {
          if (node.x === undefined || node.y === undefined) {
            node.x = this.config.width / 2 + (Math.random() - 0.5) * 200;
            node.y = this.config.height / 2 + (Math.random() - 0.5) * 200;
          }
        });
      }
    }

    this.nodesData = simulationNodes;
    this.edgesData = simulationEdges;

    // Update simulation
    if (this.simulation) {
      this.simulation.nodes(this.nodesData);
      (this.simulation.force('link') as d3.ForceLink<VisualizedGraphAgent, any>)?.links(
        this.edgesData
      );

      const componentForce = this.createComponentConstraintForce(components);
      this.simulation.force('componentConstraint', componentForce);
    }

    // Update visualization
    this.updateEdges(this.edgesData);
    this.updateNodes(this.nodesData);
    this.setupSimulationTick();

    // Restart simulation
    if (this.simulation) {
      this.simulation.alpha(0.3).restart();
    }
  }

  public updateSize(width: number, height: number): void {
    this.config.width = width;
    this.config.height = height;

    // Update center force
    if (this.simulation) {
      this.simulation.force(
        'center',
        d3.forceCenter(this.config.width / 2, this.config.height / 2)
      );
    }
  }

  public destroy(): void {
    // Stop and clean up simulation
    if (this.simulation) {
      this.simulation.stop();
      this.simulation.on('tick', null);
      // Remove all forces to prevent memory leaks
      this.simulation.force('link', null);
      this.simulation.force('charge', null);
      this.simulation.force('center', null);
      this.simulation.force('collision', null);
      this.simulation.force('componentConstraint', null);
      this.simulation = null;
    }

    // Remove all event handlers from nodes
    this.container.selectAll('.nodes g')
      .on('.drag', null)
      .on('dblclick', null);

    // Remove zoom behavior
    this.svg.on('.zoom', null);

    // Clear all data references
    this.nodesData = [];
    this.edgesData = [];
    
    // Clear callback references
    this.onNodeDoubleClick = null;

    // Remove all SVG content to break circular references
    this.svg.selectAll('*').remove();
  }
}