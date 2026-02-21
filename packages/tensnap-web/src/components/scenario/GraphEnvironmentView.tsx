import { useRef, useEffect, useState, useCallback } from 'react';
import { GraphAgent } from '@/types/model';
import * as styles from './GraphEnvironmentView.css';
import { AgentDetailsDialog } from '../../dialogs/AgentDetailsDialog';
import { InstantiatedGraphEnvironment } from '@/store/scenario/environment';
import { Trans } from '@lingui/react/macro';
import {
  EnvironmentView,
  AgentStorage,
  EdgeStorage,
  BackgroundStorage,
  AgentLayer,
  EdgeLayer,
  BackgroundLayer,
  RenderableAgent,
} from 'tensnap-web-core';

interface GraphEnvironmentViewProps {
  environment: InstantiatedGraphEnvironment;
  updateTrigger?: any;
}

export function GraphEnvironmentView({ environment, updateTrigger }: GraphEnvironmentViewProps) {
  const { id, agents, props } = environment;

  const containerRef = useRef<HTMLDivElement>(null);
  const envViewRef = useRef<EnvironmentView | null>(null);
  const agentStorageRef = useRef<AgentStorage | null>(null);
  const edgeStorageRef = useRef<EdgeStorage | null>(null);
  const agentLayerRef = useRef<AgentLayer | null>(null);

  // Keep latest agents map in a ref so the click handler always sees current data
  const agentsRef = useRef(agents);
  agentsRef.current = agents;

  const [selectedNode, setSelectedNode] = useState<GraphAgent | null>(null);

  const handleAgentClick = useCallback((agent: RenderableAgent) => {
    const found = agentsRef.current[agent.id];
    if (found) setSelectedNode(found as GraphAgent);
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
    const edgeStorage = new EdgeStorage();
    const bgStorage = new BackgroundStorage();

    const bgLayer = new BackgroundLayer(view, bgStorage);
    const edgeLayer = new EdgeLayer(view, edgeStorage, agentStorage);
    const agentLayer = new AgentLayer(view, agentStorage, {
      ...edgeLayer.buildDragHandlers(),
      draggable: true,
      showLabel: false,
      clickable: true,
      originMode: 'center',
      coordOffset: 'float',
      onAgentDoubleClick: handleAgentClick,
    });

    view.addLayer(bgLayer);
    view.addLayer(edgeLayer);
    view.addLayer(agentLayer);

    envViewRef.current = view;
    agentStorageRef.current = agentStorage;
    edgeStorageRef.current = edgeStorage;
    agentLayerRef.current = agentLayer;

    return () => {
      view.destroy();
      bgStorage.destroy();
      envViewRef.current = null;
      agentStorageRef.current = null;
      edgeStorageRef.current = null;
      agentLayerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update graph data when environment changes
  useEffect(() => {
    const agentStorage = agentStorageRef.current;
    const edgeStorage = edgeStorageRef.current;
    if (!agentStorage || !edgeStorage) return;
    agentStorage.updateAgents(Object.values(agents));
    edgeStorage.setEdges(props.edges as any);
  }, [id, agents, props.edges, updateTrigger]);

  const resetView = useCallback(() => {
    envViewRef.current?.fitToScene({ padding: 0.05 });
  }, []);

  return (
    <div className={styles.container}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
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
