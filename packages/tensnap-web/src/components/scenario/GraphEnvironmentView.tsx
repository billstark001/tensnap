import { useRef, useEffect, useState } from 'react';
import { GraphAgent } from '@/types/model';
import * as styles from './GraphEnvironmentView.css';
import { AgentDetailsDialog } from '../../dialogs/AgentDetailsDialog';
import { InstantiatedGraphEnvironment } from '@/store/scenario/environment';
import { GraphVisualizer, GraphData } from './graphVisualizer';
import { Trans } from '@lingui/react/macro';

interface GraphEnvironmentViewProps {
  environment: InstantiatedGraphEnvironment;
}

export function GraphEnvironmentView({ environment }: GraphEnvironmentViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const visualizerRef = useRef<GraphVisualizer | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphAgent | null>(null);
  const [svgSize, setSvgSize] = useState({ width: 600, height: 600 });
  const lastEnvironmentIdRef = useRef<string | number | null>(null);
  const fitViewTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Observe container size changes
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setSvgSize({ width, height });
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Initialize visualizer (only once)
  useEffect(() => {
    if (!svgRef.current) return;

    visualizerRef.current = new GraphVisualizer(svgRef.current, {
      width: svgSize.width,
      height: svgSize.height,
    });

    visualizerRef.current.setNodeClickHandler((node) => {
      setSelectedNode(node);
    });

    return () => {
      if (visualizerRef.current) {
        visualizerRef.current.destroy();
        visualizerRef.current = null;
      }
    };
  }, []);

  // Update visualizer size when container size changes
  useEffect(() => {
    if (visualizerRef.current) {
      visualizerRef.current.updateSize(svgSize.width, svgSize.height);
    }
  }, [svgSize.width, svgSize.height]);

  // Update graph data
  useEffect(() => {
    if (!visualizerRef.current) return;

    const shouldReinitialize = lastEnvironmentIdRef.current !== environment.id;
    lastEnvironmentIdRef.current = environment.id;

    const graphData: GraphData = {
      nodes: Object.values(environment.agents),
      edges: environment.props.edges,
    };

    visualizerRef.current.update(graphData, shouldReinitialize);

    // Clear any existing timeout
    if (fitViewTimeoutRef.current) {
      clearTimeout(fitViewTimeoutRef.current);
    }

    // Fit view after simulation settles
    fitViewTimeoutRef.current = setTimeout(() => {
      if (visualizerRef.current) {
        visualizerRef.current.fitViewToGraph();
      }
      fitViewTimeoutRef.current = null;
    }, 1000);

    return () => {
      if (fitViewTimeoutRef.current) {
        clearTimeout(fitViewTimeoutRef.current);
        fitViewTimeoutRef.current = null;
      }
    };
  }, [environment]);

  const resetView = () => {
    if (visualizerRef.current) {
      visualizerRef.current.fitViewToGraph();
    }
  };

  return (
    <div ref={containerRef} className={styles.container}>
      <div style={{ position: 'relative' }}>
        <svg ref={svgRef} width={svgSize.width} height={svgSize.height} className={styles.svg} />
        <button className={styles.resetButton} onClick={resetView}>
          <Trans>Reset View</Trans>
        </button>
      </div>
      <AgentDetailsDialog
        agentType="graph"
        agent={selectedNode}
        onClose={() => setSelectedNode(null)}
      />
    </div>
  );
}