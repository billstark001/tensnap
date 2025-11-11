import { useRef, useEffect, useState } from 'react';
import { GraphAgent } from '@/types/model';
import * as styles from './GraphEnvironmentView.css';
import { AgentDetailsDialog } from '../../dialogs/AgentDetailsDialog';
import { InstantiatedGraphEnvironment } from '@/store/scenario/environment';
import { GraphVisualizer, GraphData } from './graphVisualizer';
import { Trans } from '@lingui/react/macro';
import { throttle } from '@/utils';

interface GraphEnvironmentViewProps {
  environment: InstantiatedGraphEnvironment;
  updateTrigger?: any;
}

export function GraphEnvironmentView({ environment, updateTrigger }: GraphEnvironmentViewProps) {

  const { id, agents, props } = environment;


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

    const throttledResize = throttle((entries: ResizeObserverEntry[]) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setSvgSize({ width, height });
      }
    }, 16);

    const resizeObserver = new ResizeObserver(throttledResize);

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

    const shouldReinitialize = lastEnvironmentIdRef.current !== id;
    lastEnvironmentIdRef.current = id;

    const graphData: GraphData = {
      nodes: Object.values(agents),
      edges: props.edges,
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
  }, [id, agents, props.edges, updateTrigger]);

  const resetView = () => {
    if (visualizerRef.current) {
      visualizerRef.current.fitViewToGraph();
    }
  };

  return (
    <div ref={containerRef} className={styles.container}>
      <svg ref={svgRef} width={svgSize.width} height={svgSize.height} className={styles.svg} />
      <button className={styles.resetButton} onClick={resetView}>
        <Trans>Reset View</Trans>
      </button>
      <AgentDetailsDialog
        agentType="graph"
        agent={selectedNode}
        onClose={() => setSelectedNode(null)}
      />
    </div>
  );
}