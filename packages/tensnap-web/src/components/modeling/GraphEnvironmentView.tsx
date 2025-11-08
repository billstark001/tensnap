import { useRef, useEffect, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { GraphAgent } from '@/types/model';
import * as styles from './GraphEnvironmentView.css';
import { AgentDetailsDialog } from './AgentDetailsDialog';
import { InstantiatedGraphEnvironment } from '@/store/scenario-inst';

interface GraphEnvironmentViewProps {
  environment: InstantiatedGraphEnvironment;
}

interface VisualizedGraphAgent extends GraphAgent {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export function GraphEnvironmentView({ environment }: GraphEnvironmentViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedNode, setSelectedNode] = useState<GraphAgent | null>(null);
  const simulationRef = useRef<d3.Simulation<VisualizedGraphAgent, undefined> | null>(null);
  const nodesDataRef = useRef<VisualizedGraphAgent[]>([]);
  const edgesDataRef = useRef<any[]>([]);
  const lastEnvironmentIdRef = useRef<string | number | null>(null);
  const fitViewTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const findConnectedComponents = useCallback((nodes: VisualizedGraphAgent[], edges: any[]) => {
    const components: VisualizedGraphAgent[][] = [];
    const visited = new Set<string | number>();

    const dfs = (nodeId: string | number, component: VisualizedGraphAgent[]) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      const node = nodes.find(n => n.id === nodeId);
      if (!node) return;

      component.push(node);
      edges.forEach(edge => {
        const sourceId = typeof edge.source === 'object' ? edge.source.id : edge.source;
        const targetId = typeof edge.target === 'object' ? edge.target.id : edge.target;
        const nextId = sourceId === nodeId ? targetId : (targetId === nodeId ? sourceId : null);
        if (nextId && !visited.has(nextId)) dfs(nextId, component);
      });
    };

    nodes.forEach(node => {
      if (!visited.has(node.id)) {
        const component: VisualizedGraphAgent[] = [];
        dfs(node.id, component);
        if (component.length > 0) components.push(component);
      }
    });

    return components;
  }, []);

  const arrangeComponentPositions = useCallback((components: VisualizedGraphAgent[][], width: number, height: number) => {
    if (components.length === 1) return;

    const spacing = 120;
    const cols = Math.ceil(Math.sqrt(components.length));
    const cellWidth = (width - spacing) / cols;
    const cellHeight = (height - spacing) / Math.ceil(components.length / cols);

    components.forEach((component, index) => {
      const centerX = spacing / 2 + (index % cols) * cellWidth + cellWidth / 2;
      const centerY = spacing / 2 + Math.floor(index / cols) * cellHeight + cellHeight / 2;
      const radius = Math.min(cellWidth, cellHeight) / 4;

      component.forEach(node => {
        if (node.x === undefined || node.y === undefined) {
          const angle = Math.random() * 2 * Math.PI;
          node.x = centerX + Math.cos(angle) * Math.random() * radius;
          node.y = centerY + Math.sin(angle) * Math.random() * radius;
        }
      });
    });
  }, []);

  const createComponentConstraintForce = useCallback((components: VisualizedGraphAgent[][], maxDistance: number = 200) => {
    return (alpha: number) => {
      if (components.length <= 1) return;

      const centers = components.map(comp => ({
        x: d3.mean(comp, d => d.x || 0) || 0,
        y: d3.mean(comp, d => d.y || 0) || 0,
        component: comp
      }));

      for (let i = 0; i < centers.length; i++) {
        for (let j = i + 1; j < centers.length; j++) {
          const dx = centers[j].x - centers[i].x;
          const dy = centers[j].y - centers[i].y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance > maxDistance) {
            const force = (distance - maxDistance) * alpha * 0.2;
            const fx = (dx / distance) * force;
            const fy = (dy / distance) * force;

            centers[i].component.forEach(node => {
              node.vx = (node.vx || 0) + fx / centers[i].component.length;
              node.vy = (node.vy || 0) + fy / centers[i].component.length;
            });

            centers[j].component.forEach(node => {
              node.vx = (node.vx || 0) - fx / centers[j].component.length;
              node.vy = (node.vy || 0) - fy / centers[j].component.length;
            });
          }
        }
      }
    };
  }, []);

  const fitViewToGraph = useCallback((svg: d3.Selection<SVGSVGElement, unknown, null, undefined>, nodes: VisualizedGraphAgent[]) => {
    if (nodes.length === 0) return;

    const padding = 50;
    const bounds = {
      minX: d3.min(nodes, d => d.x || 0) || 0,
      maxX: d3.max(nodes, d => d.x || 0) || 0,
      minY: d3.min(nodes, d => d.y || 0) || 0,
      maxY: d3.max(nodes, d => d.y || 0) || 0
    };

    const graphWidth = bounds.maxX - bounds.minX + 2 * padding;
    const graphHeight = bounds.maxY - bounds.minY + 2 * padding;
    const scale = Math.min(600 / graphWidth, 600 / graphHeight, 1);
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;

    svg.select('.graph-container')
      .transition()
      .duration(750)
      .attr('transform', `translate(${300 - centerX * scale},${300 - centerY * scale}) scale(${scale})`);
  }, []);

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const shouldReinitialize = lastEnvironmentIdRef.current !== environment.id;

    if (shouldReinitialize) {
      svg.selectAll('*').remove();
      lastEnvironmentIdRef.current = environment.id;

      svg.call(d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => svg.select('.graph-container').attr('transform', event.transform)));

      const container = svg.append('g').attr('class', 'graph-container');

      // Arrow marker with offset to prevent overlap
      svg.append('defs')
        .append('marker')
        .attr('id', 'arrow')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 20) // Increased offset to clear node
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', '#999');

      container.append('g').attr('class', 'edges');
      container.append('g').attr('class', 'nodes');

      if (simulationRef.current) simulationRef.current.stop();

      simulationRef.current = d3.forceSimulation<VisualizedGraphAgent>()
        .force('link', d3.forceLink<VisualizedGraphAgent, any>().id(d => String(d.id)).distance(80))
        .force('charge', d3.forceManyBody().strength(-300))
        .force('center', d3.forceCenter(300, 300))
        .force('collision', d3.forceCollide().radius(25));
    }

    const simulationNodes: VisualizedGraphAgent[] = Object.values(environment.agents).map(node => {
      const existing = nodesDataRef.current.find(n => n.id === node.id);
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

    const nodeMap = new Map(simulationNodes.map(n => [n.id, n]));
    const simulationEdges = environment.props.edges.map(edge => ({
      ...edge,
      source: nodeMap.get(edge.source),
      target: nodeMap.get(edge.target),
    }));

    const components = findConnectedComponents(simulationNodes, simulationEdges);

    if (shouldReinitialize || simulationNodes.some(n => n.x === undefined || n.y === undefined)) {
      if (components.length > 1) {
        arrangeComponentPositions(components, 600, 600);
      } else {
        simulationNodes.forEach(node => {
          if (node.x === undefined || node.y === undefined) {
            node.x = 300 + (Math.random() - 0.5) * 200;
            node.y = 300 + (Math.random() - 0.5) * 200;
          }
        });
      }
    }

    nodesDataRef.current = simulationNodes;
    edgesDataRef.current = simulationEdges;

    if (simulationRef.current) {
      simulationRef.current.nodes(simulationNodes);
      (simulationRef.current.force('link') as d3.ForceLink<VisualizedGraphAgent, any>)?.links(simulationEdges);
      simulationRef.current.force('componentConstraint',
        components.length > 1 ? createComponentConstraintForce(components, 120) : null);
    }

    const container = svg.select('.graph-container');

    // Update edges - calculate edge endpoints to stop at node boundaries
    const linkSelection = container.select('.edges')
      .selectAll('line')
      .data(simulationEdges, (d: any) => `${d.source.id || d.source}-${d.target.id || d.target}`);

    linkSelection.exit().remove();

    const linkMerged = linkSelection.enter().append('line').merge(linkSelection as any);

    linkMerged
      .attr('stroke', d => d.color || '#999999')
      .attr('stroke-width', d => d.width || 1)
      .attr('stroke-dasharray', d => d.style === 'dashed' ? '5,5' : (d.style === 'dotted' ? '2,2' : null))
      .attr('marker-end', d => d.directed ? 'url(#arrow)' : null);

    // Update nodes
    const nodeSelection = container.select('.nodes').selectAll('g').data(simulationNodes, (d: any) => d.id);
    nodeSelection.exit().remove();

    const dragBehavior = d3.drag<SVGGElement, VisualizedGraphAgent>()
      .on('start', (event, d) => {
        if (!event.active && simulationRef.current) simulationRef.current.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active && simulationRef.current) simulationRef.current.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    const nodeEnter = nodeSelection.enter()
      .append('g')
      .call(dragBehavior)
      .on('dblclick', (event, d) => {
        event.stopPropagation();
        setSelectedNode(d);
      });

    const addNodeShape = (g: d3.Selection<SVGGElement, any, any, any>, d: VisualizedGraphAgent) => {
      const size = d.size || 10;
      switch (d.icon) {
        case 'square':
          g.append('rect').attr('x', -size / 2).attr('y', -size / 2).attr('width', size).attr('height', size);
          break;
        case 'triangle':
          g.append('polygon').attr('points', `0,${-size / 2} ${-size / 2},${size / 2} ${size / 2},${size / 2}`);
          break;
        default:
          g.append('circle').attr('r', size / 2);
      }
    };

    nodeEnter.each(function (d) { addNodeShape(d3.select(this), d); });
    nodeEnter.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '.35em')
      .style('font-size', '10px')
      .style('fill', 'white')
      .style('pointer-events', 'none');

    const nodeMerged = nodeEnter.merge(nodeSelection as any);

    // Update shapes if icon changed
    const getShapeType = (icon?: string) => icon === 'square' ? 'rect' : (icon === 'triangle' ? 'polygon' : 'circle');
    nodeMerged.each(function (d: any) {
      const g = d3.select(this);
      const current = g.select('rect, circle, polygon').node() as Element;
      if (current && current.tagName.toLowerCase() !== getShapeType(d.icon)) {
        g.selectAll('rect, circle, polygon').remove();
        addNodeShape(g, d);
      }
    });

    nodeMerged.selectAll('rect')
      .attr('fill', (d: any) => d.color || '#69b3a2')
      .attr('width', (d: any) => d.size || 10)
      .attr('height', (d: any) => d.size || 10)
      .attr('x', (d: any) => -(d.size || 10) / 2)
      .attr('y', (d: any) => -(d.size || 10) / 2);

    nodeMerged.selectAll('circle')
      .attr('fill', (d: any) => d.color || '#69b3a2')
      .attr('r', (d: any) => (d.size || 10) / 2);

    nodeMerged.selectAll('polygon')
      .attr('fill', (d: any) => d.color || '#69b3a2')
      .attr('points', (d: any) => {
        const size = d.size || 10;
        return `0,${-size / 2} ${-size / 2},${size / 2} ${size / 2},${size / 2}`;
      });

    nodeMerged.selectAll('text')
      .text((d: any) => String(d.id))
      .style('font-size', (d: any) => `${Math.max(8, (d.size || 10) * 0.6)}px`);

    if (simulationRef.current) {
      simulationRef.current.on('tick', () => {
        // Calculate edge endpoints to stop at node edge
        container.selectAll('.edges line')
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

        container.selectAll('.nodes g')
          .attr('transform', (d: any) => `translate(${d.x},${d.y})`);
      });

      simulationRef.current.alpha(0.3).restart();
      
      // Clear any existing timeout
      if (fitViewTimeoutRef.current) {
        clearTimeout(fitViewTimeoutRef.current);
      }
      
      fitViewTimeoutRef.current = setTimeout(() => {
        if (simulationNodes.length > 0) {
          fitViewToGraph(svg, simulationNodes);
        }
        fitViewTimeoutRef.current = null;
      }, 1000);
    }

    return () => {
      // Stop the simulation
      if (simulationRef.current) {
        simulationRef.current.stop();
        simulationRef.current.on('tick', null);
      }
      
      // Clear the fit view timeout
      if (fitViewTimeoutRef.current) {
        clearTimeout(fitViewTimeoutRef.current);
        fitViewTimeoutRef.current = null;
      }
      
      // Remove all event listeners from SVG elements
      if (svgRef.current) {
        const svg = d3.select(svgRef.current);
        // Remove all event listeners by setting them to null
        svg.selectAll('*').on('.drag', null);
        svg.selectAll('*').on('dblclick', null);
        svg.on('.zoom', null);
      }
    };
  }, [environment, findConnectedComponents, arrangeComponentPositions, createComponentConstraintForce, fitViewToGraph]);

  const resetView = useCallback(() => {
    if (svgRef.current && nodesDataRef.current.length > 0) {
      fitViewToGraph(d3.select(svgRef.current), nodesDataRef.current);
    }
  }, [fitViewToGraph]);

  return (
    <div className={styles.container}>
      <div style={{ position: 'relative' }}>
        <svg ref={svgRef} width={600} height={600} className={styles.svg} />
        <button className={styles.resetButton} onClick={resetView}>重置视图</button>
      </div>
      <AgentDetailsDialog agentType='graph' agent={selectedNode} onClose={() => setSelectedNode(null)} />
    </div>
  );
}