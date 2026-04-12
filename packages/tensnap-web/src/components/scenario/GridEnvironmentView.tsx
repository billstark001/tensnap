import { useRef, useEffect, useCallback, useState } from 'react';
import { GridAgent, AgentTrajectoryPoint } from '@/types/model';
import * as styles from './GridEnvironmentView.css';
import { InstantiatedGridEnvironment } from '@/store/scenario/environment';
import { AgentDetailsDialog } from '../../dialogs/AgentDetailsDialog';
import { Trans } from '@lingui/react/macro';
import {
  EnvironmentView,
  AgentStorage,
  BackgroundStorage,
  AgentLayer,
  BackgroundLayer,
  RenderableAgent,
  TrajectoryPoint,
  GridEnvStorage,
  GridLayer,
} from '@tensnap/core';

interface GridEnvironmentViewProps {
  environment: InstantiatedGridEnvironment;
  updateTrigger?: any;
}

/** Convert web model GridAgent to web-core RenderableAgent */
function toRenderableAgent(agent: GridAgent): RenderableAgent {
  return {
    id: agent.id,
    x: agent.x,
    y: agent.y,
    heading: agent.heading,
    color: agent.color,
    icon: agent.icon,
    size: agent.size,
    trajectoryColor: agent.trajectory_color,
    data: agent.data as Record<string, unknown>,
  };
}

/** Convert web model AgentTrajectoryPoint to web-core TrajectoryPoint */
function toTrajectoryPoint(pt: AgentTrajectoryPoint): TrajectoryPoint {
  return { x: pt.x, y: pt.y, time: pt.time, color: pt.color };
}

export function GridEnvironmentView({ environment, updateTrigger }: GridEnvironmentViewProps) {
  const { props: envProps, agents: agentsProps, agentTraces: traceProps } = environment;

  const containerRef = useRef<HTMLDivElement>(null);
  const envViewRef = useRef<EnvironmentView | null>(null);
  const agentStorageRef = useRef<AgentStorage | null>(null);
  const bgStorageRef = useRef<BackgroundStorage | null>(null);
  const gridStorageRef = useRef<GridEnvStorage | null>(null);

  const bgLayerRef = useRef<BackgroundLayer | null>(null);
  const agentLayerRef = useRef<AgentLayer | null>(null);

  // Keep latest agents map in a ref so the click handler always sees current data
  const agentsRef = useRef(agentsProps);
  agentsRef.current = agentsProps;

  const [selectedAgent, setSelectedAgent] = useState<GridAgent | null>(null);

  const handleAgentClick = useCallback((agent: RenderableAgent) => {
    const found = agentsRef.current[agent.id];
    if (found) setSelectedAgent(found as GridAgent);
  }, []);

  // Initialize view once
  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EnvironmentView(containerRef.current, {
      type: 'design',
      enablePan: true,
      enableTouchZoom: true,
      enableWheelZoom: true,
    });
    const agentStorage = new AgentStorage();
    const bgStorage = new BackgroundStorage();
    const gridStorage = new GridEnvStorage();

    const bgLayer = new BackgroundLayer(view, bgStorage, {
      sceneBounds: { width: envProps.width, height: envProps.height },
    });
    const agentLayer = new AgentLayer(view, agentStorage, {
      clickable: true,
      coordOffset: envProps.coord_offset ?? 'int',
      sceneBounds: { width: envProps.width, height: envProps.height },
      originMode: 'bottom-left',
      onAgentClick: handleAgentClick,
    });
    const gridLayer = new GridLayer(view, gridStorage);

    view.addLayer(bgLayer);
    view.addLayer(agentLayer);
    view.addLayer(gridLayer);

    envViewRef.current = view;
    agentStorageRef.current = agentStorage;
    bgStorageRef.current = bgStorage;
    gridStorageRef.current = gridStorage;
    bgLayerRef.current = bgLayer;
    agentLayerRef.current = agentLayer;

    return () => {
      view.destroy();
      bgStorage.destroy();
      envViewRef.current = null;
      agentStorageRef.current = null;
      bgStorageRef.current = null;
      bgLayerRef.current = null;
      agentLayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update background when env props change
  useEffect(() => {
    bgStorageRef.current?.setBackground(envProps.background);
  }, [envProps.background]);

  // Update agents
  useEffect(() => {
    const agentStorage = agentStorageRef.current;
    if (!agentStorage) return;
    const renderableAgents = Object.values(agentsProps).map(toRenderableAgent);
    agentStorage.setAgents(renderableAgents);
  }, [agentsProps, updateTrigger]);

  // Update trajectories
  useEffect(() => {
    const agentStorage = agentStorageRef.current;
    if (!agentStorage || !traceProps) return;
    const converted: Record<string, TrajectoryPoint[]> = {};
    for (const [id, pts] of Object.entries(traceProps)) {
      converted[id] = pts.map(toTrajectoryPoint);
    }
    agentStorage.setTrajectories(converted);
  }, [traceProps, updateTrigger]);

  const resetView = useCallback(() => {
    envViewRef.current?.fitToScene({ padding: 0 });
  }, [envViewRef.current]);

  useEffect(() => {
    bgLayerRef.current?.setSceneBounds(envProps);
    agentLayerRef.current?.setSceneBounds(envProps);
    envViewRef.current?.fitToScene({ padding: 0 });
  }, [envProps.width, envProps.height]);

  return (
    <div className={styles.container}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <button className={styles.resetButton} onClick={resetView}>
        <Trans>Reset View</Trans>
      </button>
      <AgentDetailsDialog
        agentType='grid'
        agent={selectedAgent}
        onClose={() => setSelectedAgent(null)}
      />
    </div>
  );
}
