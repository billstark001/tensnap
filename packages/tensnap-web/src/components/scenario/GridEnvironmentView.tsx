import { useRef, useEffect, useCallback, useState } from 'react';
import { GridAgent } from '@/types/model';
import * as styles from './GridEnvironmentView.css';
import { InstantiatedGridEnvironment } from '@/store/scenario/environment';
import { AgentDetailsDialog } from '../../dialogs/AgentDetailsDialog';
import { GridVisualizer } from './gridVisualizer';

interface GridEnvironmentViewProps {
  environment: InstantiatedGridEnvironment;
  updateTrigger?: any;
}

export function GridEnvironmentView({ environment, updateTrigger }: GridEnvironmentViewProps) {
  const { props: envProps, agents: agentsProps, tiles: tilesProps, agentTraces: traceProps } = environment;
  const containerRef = useRef<HTMLDivElement>(null);
  const visualizerRef = useRef<GridVisualizer | null>(null);

  const [selectedAgent, setSelectedAgent] = useState<GridAgent | null>(null);

  const handleAgentClick = useCallback((agent: GridAgent) => {
    setSelectedAgent(agent);
  }, []);

  // Initialize visualizer
  useEffect(() => {
    if (!containerRef.current) return;

    visualizerRef.current = new GridVisualizer(containerRef.current, {
      width: envProps.width,
      height: envProps.height,
      background: envProps.background,
    });

    visualizerRef.current.setEventHandlers({
      onAgentClick: handleAgentClick,
    });

    return () => {
      visualizerRef.current?.destroy();
      visualizerRef.current = null;
    };
  }, []);

  // Update environment properties
  useEffect(() => {
    visualizerRef.current?.updateEnvironment({
      width: envProps.width,
      height: envProps.height,
      coordOffset: envProps.coord_offset,
      background: envProps.background,
    });
  }, [envProps.width, envProps.height, envProps.background, envProps.coord_offset]);

  // Update agents
  useEffect(() => {
    visualizerRef.current?.updateAgents(agentsProps);
  }, [agentsProps, updateTrigger]);

  // Update tiles
  useEffect(() => {
    visualizerRef.current?.updateTiles(tilesProps);
  }, [tilesProps, updateTrigger]);

  // Update trajectories
  useEffect(() => {
    if (traceProps) {
      visualizerRef.current?.updateTrajectories(traceProps);
    }
  }, [traceProps, updateTrigger]);

  // Update event handlers
  useEffect(() => {
    visualizerRef.current?.setEventHandlers({
      onAgentClick: handleAgentClick,
    });
  }, [handleAgentClick]);

  return (
    <div className={styles.container}>
      <div ref={containerRef} className={styles.canvasContainer} />

      <AgentDetailsDialog
        agentType='grid'
        agent={selectedAgent}
        onClose={() => setSelectedAgent(null)}
      />

    </div>
  );
}