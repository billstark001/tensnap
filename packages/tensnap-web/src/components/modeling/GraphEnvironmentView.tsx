import { useRef, useEffect, useState, useCallback } from 'react';
import * as d3 from 'd3';
import { GraphAgent, AgentId } from '@/types/model';
import * as styles from './GraphEnvironmentView.css';
import * as Dialog from '@radix-ui/react-dialog';
import { dialogOverlay, dialogContent, dialogTitle, dialogClose } from '@/styles/dialog.css';
import { X } from 'lucide-react';
import { InstantiatedGraphEnvironment } from '@/types/model-inst';

interface GraphEnvironmentViewProps {
  environment: InstantiatedGraphEnvironment;
}

// Extend GraphNode with D3 simulation properties
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

  // 检测连通分量的函数
  const findConnectedComponents = useCallback((nodes: VisualizedGraphAgent[], edges: any[]) => {
    const components: VisualizedGraphAgent[][] = [];
    const visited = new Set<string | number>();

    const dfs = (nodeId: string | number, component: VisualizedGraphAgent[]) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const node = nodes.find(n => n.id === nodeId);
      if (node) {
        component.push(node);

        // 找到所有连接的节点
        edges.forEach(edge => {
          const sourceId = typeof edge.source === 'object' ? edge.source.id : edge.source;
          const targetId = typeof edge.target === 'object' ? edge.target.id : edge.target;

          if (sourceId === nodeId && !visited.has(targetId)) {
            dfs(targetId, component);
          } else if (targetId === nodeId && !visited.has(sourceId)) {
            dfs(sourceId, component);
          }
        });
      }
    };

    nodes.forEach(node => {
      if (!visited.has(node.id)) {
        const component: VisualizedGraphAgent[] = [];
        dfs(node.id, component);
        if (component.length > 0) {
          components.push(component);
        }
      }
    });

    return components;
  }, []);

  // 为连通分量分配初始位置的函数
  const arrangeComponentPositions = useCallback((components: VisualizedGraphAgent[][], width: number, height: number) => {
    if (components.length === 1) return;

    // 计算每个分量需要的大概空间
    const componentSpacing = 120;
    const cols = Math.ceil(Math.sqrt(components.length));
    const rows = Math.ceil(components.length / cols);

    const cellWidth = (width - componentSpacing) / cols;
    const cellHeight = (height - componentSpacing) / rows;

    components.forEach((component, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);

      const centerX = componentSpacing / 2 + col * cellWidth + cellWidth / 2;
      const centerY = componentSpacing / 2 + row * cellHeight + cellHeight / 2;

      // 在分量中心周围随机分布节点
      const radius = Math.min(cellWidth, cellHeight) / 4;
      component.forEach(node => {
        if (node.x === undefined || node.y === undefined) {
          const angle = Math.random() * 2 * Math.PI;
          const distance = Math.random() * radius;
          node.x = centerX + Math.cos(angle) * distance;
          node.y = centerY + Math.sin(angle) * distance;
        }
      });
    });
  }, []);

  // 为连通分量创建约束力的函数
  const createComponentConstraintForce = useCallback((components: VisualizedGraphAgent[][], maxDistance: number = 200) => {
    return (alpha: number) => {
      if (components.length <= 1) return;

      // 计算每个分量的中心
      const componentCenters = components.map(component => {
        const centerX = d3.mean(component, d => d.x || 0) || 0;
        const centerY = d3.mean(component, d => d.y || 0) || 0;
        return { x: centerX, y: centerY, component };
      });

      // 对于每对分量，如果距离太远则施加吸引力
      for (let i = 0; i < componentCenters.length; i++) {
        for (let j = i + 1; j < componentCenters.length; j++) {
          const center1 = componentCenters[i];
          const center2 = componentCenters[j];

          const dx = center2.x - center1.x;
          const dy = center2.y - center1.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance > maxDistance) {
            const force = (distance - maxDistance) * alpha * 0.2; // 增加力的强度
            const fx = (dx / distance) * force;
            const fy = (dy / distance) * force;

            // 对分量1中的节点施加向右的力
            center1.component.forEach(node => {
              node.vx = (node.vx || 0) + fx / center1.component.length;
              node.vy = (node.vy || 0) + fy / center1.component.length;
            });

            // 对分量2中的节点施加向左的力
            center2.component.forEach(node => {
              node.vx = (node.vx || 0) - fx / center2.component.length;
              node.vy = (node.vy || 0) - fy / center2.component.length;
            });
          }
        }
      }
    };
  }, []);

  // 自适应视图的函数
  const fitViewToGraph = useCallback((svg: d3.Selection<SVGSVGElement, unknown, null, undefined>, nodes: VisualizedGraphAgent[]) => {
    if (nodes.length === 0) return;

    const padding = 50;
    const minX = d3.min(nodes, d => d.x || 0) || 0;
    const maxX = d3.max(nodes, d => d.x || 0) || 0;
    const minY = d3.min(nodes, d => d.y || 0) || 0;
    const maxY = d3.max(nodes, d => d.y || 0) || 0;

    const graphWidth = maxX - minX + 2 * padding;
    const graphHeight = maxY - minY + 2 * padding;

    const svgWidth = 600;
    const svgHeight = 600;

    const scale = Math.min(svgWidth / graphWidth, svgHeight / graphHeight, 1);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const translateX = svgWidth / 2 - centerX * scale;
    const translateY = svgHeight / 2 - centerY * scale;

    const g = svg.select('.graph-container');
    if (!g.empty()) {
      g.transition()
        .duration(750)
        .attr('transform', `translate(${translateX},${translateY}) scale(${scale})`);
    }
  }, []);

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const width = 600;
    const height = 600;

    // 检查是否需要完全重新初始化（ID改变或首次渲染）
    const shouldReinitialize = lastEnvironmentIdRef.current !== environment.id;

    if (shouldReinitialize) {
      // 完全重新初始化
      svg.selectAll('*').remove();
      lastEnvironmentIdRef.current = environment.id;

      // 设置缩放行为
      const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.1, 4])
        .on('zoom', (event) => {
          svg.select('.graph-container')
            .attr('transform', event.transform);
        });

      svg.call(zoom);

      // 创建主容器
      const container = svg.append('g').attr('class', 'graph-container');

      // 创建箭头标记
      const defs = svg.append('defs');
      defs.selectAll('marker')
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

      // 创建边和节点容器
      container.append('g').attr('class', 'edges');
      container.append('g').attr('class', 'nodes');

      // 停止之前的仿真
      if (simulationRef.current) {
        simulationRef.current.stop();
      }

      // 创建新的仿真
      simulationRef.current = d3.forceSimulation<VisualizedGraphAgent>()
        .force('link', d3.forceLink<VisualizedGraphAgent, any>()
          .id(d => String(d.id))
          .distance(80))
        .force('charge', d3.forceManyBody().strength(-300))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius(25));
    }

    // 创建或更新节点数据
    const simulationNodes: VisualizedGraphAgent[] = Object.values(environment.agents).map(node => {
      // 如果是增量更新，保留现有节点的位置
      const existingNode = nodesDataRef.current.find(n => n.id === node.id);
      return {
        ...node,
        x: existingNode?.x ?? node.x,
        y: existingNode?.y ?? node.y,
        vx: existingNode?.vx ?? 0,
        vy: existingNode?.vy ?? 0,
      };
    });

    // 创建节点映射
    const nodeMap = new Map<AgentId, VisualizedGraphAgent>();
    simulationNodes.forEach(node => {
      nodeMap.set(node.id, node);
    });

    // 创建边数据
    const simulationEdges = environment.props.edges.map(edge => ({
      ...edge,
      source: nodeMap.get(edge.source),
      target: nodeMap.get(edge.target),
    }));

    // 检测连通分量
    const components = findConnectedComponents(simulationNodes, simulationEdges);

    // 为没有初始位置的节点分配位置
    if (shouldReinitialize || simulationNodes.some(n => n.x === undefined || n.y === undefined)) {
      if (components.length > 1) {
        arrangeComponentPositions(components, width, height);
      } else {
        // 单个连通分量，在中心周围随机分布
        simulationNodes.forEach(node => {
          if (node.x === undefined || node.y === undefined) {
            node.x = width / 2 + (Math.random() - 0.5) * 200;
            node.y = height / 2 + (Math.random() - 0.5) * 200;
          }
        });
      }
    }

    // 更新引用
    nodesDataRef.current = simulationNodes;
    edgesDataRef.current = simulationEdges;

    // 更新仿真数据
    if (simulationRef.current) {
      simulationRef.current.nodes(simulationNodes);
      const linkForce = simulationRef.current.force('link') as d3.ForceLink<VisualizedGraphAgent, any>;
      if (linkForce) {
        linkForce.links(simulationEdges);
      }

      // 添加连通分量约束力
      if (components.length > 1) {
        const constraintForce = createComponentConstraintForce(components, 120); // 减小最大距离
        simulationRef.current.force('componentConstraint', constraintForce);
      } else {
        // 如果只有一个连通分量，移除约束力
        simulationRef.current.force('componentConstraint', null);
      }
    }

    // 获取容器
    const container = svg.select('.graph-container');

    // 更新边
    const linkSelection = container.select('.edges')
      .selectAll('line')
      .data(simulationEdges, (d: any) => `${d.source.id || d.source}-${d.target.id || d.target}`);

    linkSelection.exit().remove();

    linkSelection.enter()
      .append('line')
      .merge(linkSelection as any)
      .attr('stroke', d => d.color || '#999999')
      .attr('stroke-width', d => d.width || 1)
      .attr('stroke-dasharray', d => {
        if (d.style === 'dashed') return '5,5';
        if (d.style === 'dotted') return '2,2';
        return null;
      })
      .attr('marker-end', d => d.directed ? 'url(#arrow)' : null);

    // 更新节点
    const nodeSelection = container.select('.nodes')
      .selectAll('g')
      .data(simulationNodes, (d: any) => d.id);

    nodeSelection.exit().remove();

    const nodeEnter = nodeSelection.enter()
      .append('g')
      .call(d3.drag<SVGGElement, VisualizedGraphAgent>()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended))
      .on('dblclick', (event, d) => {
        event.stopPropagation();
        setSelectedNode(d);
      });

    // 添加节点形状
    nodeEnter.each(function (d) {
      const g = d3.select(this);
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
          g.append('polygon')
            .attr('points', `0,${-size / 2} ${-size / 2},${size / 2} ${size / 2},${size / 2}`);
          break;

        default: // circle
          g.append('circle')
            .attr('r', size / 2);
      }
    });

    // 添加标签
    nodeEnter.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '.35em')
      .style('font-size', '10px')
      .style('fill', 'white')
      .style('pointer-events', 'none');

    // 更新现有节点
    const nodeMerged = nodeEnter.merge(nodeSelection as any);

    // 更新节点颜色和大小
    nodeMerged.selectAll('rect, circle, polygon')
      .attr('fill', (d: any) => d.color || '#69b3a2');

    nodeMerged.selectAll('text')
      .text((d: any) => String(d.id));

    // 仿真tick事件处理
    if (simulationRef.current) {
      simulationRef.current.on('tick', () => {
        container.selectAll('.edges line')
          .attr('x1', (d: any) => d.source.x)
          .attr('y1', (d: any) => d.source.y)
          .attr('x2', (d: any) => d.target.x)
          .attr('y2', (d: any) => d.target.y);

        container.selectAll('.nodes g')
          .attr('transform', (d: any) => `translate(${d.x},${d.y})`);
      });

      // 重新启动仿真
      simulationRef.current.alpha(0.3).restart();

      // 在仿真稳定后自适应视图
      setTimeout(() => {
        if (simulationNodes.length > 0) {
          fitViewToGraph(svg, simulationNodes);
        }
      }, 1000);
    }

    function dragstarted(event: d3.D3DragEvent<SVGGElement, VisualizedGraphAgent, VisualizedGraphAgent>, d: VisualizedGraphAgent) {
      if (!event.active && simulationRef.current) {
        simulationRef.current.alphaTarget(0.3).restart();
      }
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event: d3.D3DragEvent<SVGGElement, VisualizedGraphAgent, VisualizedGraphAgent>, d: VisualizedGraphAgent) {
      d.fx = event.x;
      d.fy = event.y;
    }

    function dragended(event: d3.D3DragEvent<SVGGElement, VisualizedGraphAgent, VisualizedGraphAgent>, d: VisualizedGraphAgent) {
      if (!event.active && simulationRef.current) {
        simulationRef.current.alphaTarget(0);
      }
      d.fx = null;
      d.fy = null;
    }

    return () => {
      if (simulationRef.current) {
        simulationRef.current.stop();
      }
    };
  }, [environment, fitViewToGraph]);

  // 重置视图到适合图形的缩放
  const resetView = useCallback(() => {
    if (!svgRef.current || nodesDataRef.current.length === 0) return;

    const svg = d3.select(svgRef.current);
    fitViewToGraph(svg, nodesDataRef.current);
  }, [fitViewToGraph]);

  return (
    <div className={styles.container}>
      <div style={{ position: 'relative' }}>
        <svg
          ref={svgRef}
          width={600}
          height={600}
          className={styles.svg}
        />
        <button
          onClick={resetView}
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            padding: '8px 12px',
            backgroundColor: 'rgba(255, 255, 255, 0.9)',
            border: '1px solid #ccc',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '12px',
            zIndex: 10
          }}
        >
          重置视图
        </button>
      </div>

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