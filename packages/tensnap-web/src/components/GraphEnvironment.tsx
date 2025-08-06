import { useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { GraphEnvironment, GraphNode } from '../types';

interface GraphEnvironmentViewProps {
  environment: GraphEnvironment;
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
    
    // Create simulation
    const simulation = d3.forceSimulation<GraphNode>()
      .force('link', d3.forceLink<GraphNode, any>()
        .id(d => d.id.toString())
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
      .data(environment.edges)
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
      .data(environment.nodes)
      .enter().append('g')
      .call(d3.drag<SVGGElement, GraphNode>()
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
      .text(d => d.id.toString())
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
    simulation.nodes(environment.nodes);
    (simulation.force('link') as any).links(environment.edges);
    
    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);
      
      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });
    
    function dragstarted(event: any, d: any) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }
    
    function dragged(event: any, d: any) {
      d.fx = event.x;
      d.fy = event.y;
    }
    
    function dragended(event: any, d: any) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }
    
    return () => {
      simulation.stop();
    };
  }, [environment]);
  
  return (
    <div style={{ position: 'relative' }}>
      <svg
        ref={svgRef}
        width={600}
        height={600}
        style={{
          border: '1px solid #cccccc',
          borderRadius: '4px',
          background: '#fafafa'
        }}
      />
      
      {selectedNode && (
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'white',
            padding: '20px',
            borderRadius: '8px',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
            zIndex: 1000
          }}
        >
          <h3>Node Details</h3>
          <p>ID: {selectedNode.id}</p>
          <p>Color: {selectedNode.color || 'default'}</p>
          <p>Size: {selectedNode.size || 10}</p>
          {selectedNode.data && (
            <div>
              <h4>Custom Data:</h4>
              <pre>{JSON.stringify(selectedNode.data, null, 2)}</pre>
            </div>
          )}
          <button onClick={() => setSelectedNode(null)}>Close</button>
        </div>
      )}
    </div>
  );
}