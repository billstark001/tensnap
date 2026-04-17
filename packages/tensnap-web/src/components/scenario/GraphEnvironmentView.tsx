import { useRef, useEffect, useState, useCallback } from 'react';
import { GraphAgent } from '@/types/model';
import * as styles from './GraphEnvironmentView.css';
import { AgentDetailsDialog } from '../../dialogs/AgentDetailsDialog';
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
  ScenarioEnvironmentState,
} from '@tensnap/core';

interface GraphEnvironmentViewProps {
  environment: ScenarioEnvironmentState;
  updateTrigger?: number;
}

export function GraphEnvironmentView({ environment, updateTrigger }: GraphEnvironmentViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const envViewRef = useRef<EnvironmentView | null>(null);
  const agentStoragesRef = useRef<AgentStorage[]>([]);

  const [selectedNode, setSelectedNode] = useState<GraphAgent | null>(null);

  const handleAgentClick = useCallback((agent: RenderableAgent) => {
    for (const storage of agentStoragesRef.current) {
      const found = storage.getAgent(agent.id);
      if (found) {
        setSelectedNode(found as GraphAgent);
        return;
      }
    }
    setSelectedNode(agent as GraphAgent);
  }, []);

  // Rebuild layers only when structure changes; node/edge updates flow via storage subscriptions.
  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EnvironmentView(containerRef.current, {
      type: 'design',
      enablePan: true,
      enableTouchZoom: true,
      enableWheelZoom: true,
    });
    const layerStates = [...environment.layers.values()];
    const agentStorageByLayerId = new Map<string, AgentStorage>();
    const agentStorages: AgentStorage[] = [];

    for (const layer of layerStates) {
      if (layer.storage instanceof BackgroundStorage) {
        view.addLayer(new BackgroundLayer(view, layer.storage));
      }
      if (layer.storage instanceof AgentStorage) {
        agentStorageByLayerId.set(layer.id, layer.storage);
        agentStorages.push(layer.storage);
      }
    }

    let firstEdgeLayer: EdgeLayer | null = null;
    for (const layer of layerStates) {
      if (!(layer.storage instanceof EdgeStorage)) {
        continue;
      }
      const linkedAgentStorage = (
        (layer.agentLayerRef && agentStorageByLayerId.get(layer.agentLayerRef))
        ?? agentStorages[0]
      );
      if (!linkedAgentStorage) {
        continue;
      }
      const edgeLayer = new EdgeLayer(view, layer.storage, linkedAgentStorage);
      view.addLayer(edgeLayer);
      if (!firstEdgeLayer) {
        firstEdgeLayer = edgeLayer;
      }
    }

    for (const storage of agentStorages) {
      const agentLayer = new AgentLayer(view, storage, {
        ...(firstEdgeLayer ? firstEdgeLayer.buildDragHandlers() : {}),
        draggable: true,
        showLabel: false,
        clickable: true,
        originMode: 'center',
        coordOffset: 'float',
        onAgentDoubleClick: handleAgentClick,
      });
      view.addLayer(agentLayer);
    }

    view.fitToScene({ padding: 0.05 });

    envViewRef.current = view;
    agentStoragesRef.current = agentStorages;

    return () => {
      view.destroy();
      envViewRef.current = null;
      agentStoragesRef.current = [];
    };
  }, [environment, updateTrigger, handleAgentClick]);

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
