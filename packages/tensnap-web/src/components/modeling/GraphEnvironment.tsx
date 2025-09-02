import { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { GraphEnvironment, GraphNode } from '@/types/modeling';
import * as styles from './GraphEnvironment.css';
import * as Dialog from '@radix-ui/react-dialog';
import { dialogOverlay, dialogContent, dialogTitle, dialogClose } from '@/styles/dialog.css';
import { X } from 'lucide-react';

interface GraphEnvironmentViewProps {
  environment: GraphEnvironment;
}

// Extend GraphNode with D3 simulation properties
interface SimulationNode extends GraphNode {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export function GraphEnvironmentView({ environment }: GraphEnvironmentViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  
  useEffect(() => {
    if (!svgRef.current) return;
    
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    
    const width = 600;
    const height = 600;
    
    // Create copies of nodes with proper D3 simulation properties
    const simulationNodes: SimulationNode[] = environment.nodes.map(node => ({
      ...node,
      x: node.x || Math.random() * width,
      y: node.y || Math.random() * height,
    }));
    
    // Create a map for quick node lookup by id
    const nodeMap = new Map<string | number, SimulationNode>();
    simulationNodes.forEach(node => {
      nodeMap.set(node.id, node);
    });
    
    // Create edges with proper node references
    const simulationEdges = environment.edges.map(edge => ({
      ...edge,
      source: nodeMap.get(edge.source) || edge.source,
      target: nodeMap.get(edge.target) || edge.target,
    }));
    
    // Create simulation
    const simulation = d3.forceSimulation<SimulationNode>()
      .force('link', d3.forceLink<SimulationNode, any>(simulationEdges)
        .id(d => String(d.id)) // Ensure ID is always a string
        .distance(100))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(20));
    
    // Create arrow markers for directed edges
    svg.append('defs').selectAll('marker')
      .data(['arrow'])
      .enter().append('marker')
      .attr('id', d => d)
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 15)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#999');
    
    // Add edges
    const link = svg.append('g')
      .attr('class', 'edges')
      .selectAll('line')
      .data(simulationEdges)
      .enter().append('line')
      .attr('stroke', d => d.color || '#999999')
      .attr('stroke-width', d => d.width || 1)
      .attr('stroke-dasharray', d => {
        if (d.style === 'dashed') return '5,5';
        if (d.style === 'dotted') return '2,2';
        return null;
      })
      .attr('marker-end', d => d.directed ? 'url(#arrow)' : null);
    
    // Add node groups
    const node = svg.append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(simulationNodes)
      .enter().append('g')
      .call(d3.drag<SVGGElement, SimulationNode>()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended));
    
    // Add node shapes
    node.each(function(d) {
      const g = d3.select(this);
      const size = d.size || 10;
      
      switch (d.icon) {
        case 'square':
          g.append('rect')
            .attr('x', -size / 2)
            .attr('y', -size / 2)
            .attr('width', size)
            .attr('height', size)
            .attr('fill', d.color || '#69b3a2');
          break;
        
        case 'triangle':
          g.append('polygon')
            .attr('points', `0,${-size/2} ${-size/2},${size/2} ${size/2},${size/2}`)
            .attr('fill', d.color || '#69b3a2');
          break;
        
        default: // circle
          g.append('circle')
            .attr('r', size / 2)
            .attr('fill', d.color || '#69b3a2');
      }
    });
    
    // Add labels
    node.append('text')
      .text(d => String(d.id))
      .attr('text-anchor', 'middle')
      .attr('dy', '.35em')
      .style('font-size', '10px')
      .style('fill', 'white')
      .style('pointer-events', 'none');
    
    // Add double-click handler
    node.on('dblclick', (event, d) => {
      event.stopPropagation();
      setSelectedNode(d);
    });
    
    // Update positions on tick
    simulation.nodes(simulationNodes);
    // No need to set links again as they are already passed to forceLink during creation
    
    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);
      
      node.attr('transform', (d: SimulationNode) => `translate(${d.x},${d.y})`);
    });
    
    function dragstarted(event: d3.D3DragEvent<SVGGElement, SimulationNode, SimulationNode>, d: SimulationNode) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }
    
    function dragged(event: d3.D3DragEvent<SVGGElement, SimulationNode, SimulationNode>, d: SimulationNode) {
      d.fx = event.x;
      d.fy = event.y;
    }
    
    function dragended(event: d3.D3DragEvent<SVGGElement, SimulationNode, SimulationNode>, d: SimulationNode) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }
    
    return () => {
      simulation.stop();
    };
  }, [environment]);
  
  return (
    <div className={styles.container}>
      <svg
        ref={svgRef}
        width={600}
        height={600}
        className={styles.svg}
      />
      
      <Dialog.Root open={!!selectedNode} onOpenChange={(open) => !open && setSelectedNode(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className={dialogOverlay} />
          <Dialog.Content className={dialogContent}>
            <Dialog.Title className={dialogTitle}>Node Details</Dialog.Title>
            
            {selectedNode && (
              <div>
                <p style={{ marginBottom: '8px' }}>
                  <strong>ID:</strong> {selectedNode.id}
                </p>
                <p style={{ marginBottom: '8px' }}>
                  <strong>Color:</strong> {selectedNode.color || 'default'}
                </p>
                <p style={{ marginBottom: '8px' }}>
                  <strong>Size:</strong> {selectedNode.size || 10}
                </p>
                {selectedNode.data && (
                  <div>
                    <h4 style={{ marginBottom: '8px', marginTop: '16px' }}>Custom Data:</h4>
                    <pre style={{ 
                      backgroundColor: '#f5f5f5', 
                      padding: '8px', 
                      borderRadius: '4px',
                      fontSize: '12px',
                      overflow: 'auto',
                      maxHeight: '200px'
                    }}>
                      {JSON.stringify(selectedNode.data, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
            
            <Dialog.Close asChild>
              <button className={dialogClose} aria-label="Close">
                <X size={16} />
              </button>
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}