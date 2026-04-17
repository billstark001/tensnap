import { useRef, useEffect, useCallback, useState } from 'react';
import { GridAgent } from '@/types/model';
import * as styles from './GridEnvironmentView.css';
import { AgentDetailsDialog } from '../../dialogs/AgentDetailsDialog';
import { Trans } from '@lingui/react/macro';
import { useScenarioStore } from '@/store/scenario/store';
import {
  EnvironmentView,
  AgentStorage,
  BackgroundStorage,
  AgentLayer,
  BackgroundLayer,
  RenderableAgent,
  GridEnvStorage,
  GridLayer,
  ScenarioEnvironmentState,
} from '@tensnap/core';

interface GridEnvironmentViewProps {
  environment: ScenarioEnvironmentState;
  updateTrigger?: number;
}

export function GridEnvironmentView({ environment, updateTrigger }: GridEnvironmentViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const envViewRef = useRef<EnvironmentView | null>(null);
  const agentStoragesRef = useRef<AgentStorage[]>([]);
  const backgroundLayersRef = useRef<BackgroundLayer[]>([]);
  const agentLayersRef = useRef<AgentLayer[]>([]);

  const [selectedAgent, setSelectedAgent] = useState<GridAgent | null>(null);
  const scenario = useScenarioStore((store) => store.scenario);
  const assetRevision = useScenarioStore((store) => store._assetRevision);

  const resolveSceneBounds = useCallback((): { width: number; height: number } | undefined => {
    for (const layer of environment.layers.values()) {
      const width = layer.metadata.width;
      const height = layer.metadata.height;
      if (typeof width === 'number' && typeof height === 'number') {
        return { width, height };
      }
    }
    return undefined;
  }, [environment]);

  const handleAgentClick = useCallback((agent: RenderableAgent) => {
    for (const storage of agentStoragesRef.current) {
      const found = storage.getAgent(agent.id);
      if (found) {
        setSelectedAgent(found as GridAgent);
        return;
      }
    }
    setSelectedAgent(agent as GridAgent);
  }, []);

  // Rebuild layers when environment structure changes. Per-step updates flow via storage subscriptions.
  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EnvironmentView(containerRef.current, {
      type: 'design',
      enablePan: true,
      enableTouchZoom: true,
      enableWheelZoom: true,
    });
    const sceneBounds = resolveSceneBounds();
    const layers = [...environment.layers.values()];
    const metadataSource = layers.find((layer) => (
      layer.layerType === 'grid'
      || (typeof layer.metadata?.width === 'number' && typeof layer.metadata?.height === 'number')
    ));
    const viewMetadata = (metadataSource?.metadata ?? {}) as Record<string, unknown>;
    const showGrid = viewMetadata.show_grid !== false;
    const backgroundColor = typeof viewMetadata.background_color === 'string'
      ? viewMetadata.background_color
      : null;

    const nextAgentStorages: AgentStorage[] = [];
    const nextBackgroundLayers: BackgroundLayer[] = [];
    const nextAgentLayers: AgentLayer[] = [];

    const hasBackgroundStorage = layers.some((layer) => layer.storage instanceof BackgroundStorage);
    if (!hasBackgroundStorage && backgroundColor) {
      const syntheticBackgroundStorage = new BackgroundStorage();
      void syntheticBackgroundStorage.setBackground(backgroundColor);
      const bgLayer = new BackgroundLayer(
        view,
        syntheticBackgroundStorage,
        sceneBounds ? { sceneBounds } : undefined,
      );
      view.addLayer(bgLayer);
      nextBackgroundLayers.push(bgLayer);
    }

    for (const layer of environment.layers.values()) {
      if (layer.storage instanceof BackgroundStorage) {
        const bgLayer = new BackgroundLayer(
          view,
          layer.storage,
          sceneBounds ? { sceneBounds } : undefined,
        );
        view.addLayer(bgLayer);
        nextBackgroundLayers.push(bgLayer);
        continue;
      }

      if (layer.storage instanceof GridEnvStorage) {
        if (showGrid) {
          const gridLayer = new GridLayer(view, layer.storage);
          view.addLayer(gridLayer);
        }
        continue;
      }

      if (layer.storage instanceof AgentStorage) {
        const layerSceneBounds = (
          typeof layer.metadata.width === 'number' && typeof layer.metadata.height === 'number'
        ) ? { width: layer.metadata.width, height: layer.metadata.height } : sceneBounds;

        const agentLayer = new AgentLayer(view, layer.storage, {
          clickable: true,
          coordOffset: layer.metadata.coord_offset === 'float' ? 'float' : 'int',
          sceneBounds: layerSceneBounds,
          originMode: 'bottom-left',
          resolveAssetUrl: (assetId) => scenario?.assets.getUrl(assetId),
          onAgentClick: handleAgentClick,
        });
        view.addLayer(agentLayer);
        nextAgentLayers.push(agentLayer);
        nextAgentStorages.push(layer.storage);
      }
    }

    view.fitToScene({ padding: 0 });

    envViewRef.current = view;
    agentStoragesRef.current = nextAgentStorages;
    backgroundLayersRef.current = nextBackgroundLayers;
    agentLayersRef.current = nextAgentLayers;

    return () => {
      view.destroy();
      envViewRef.current = null;
      agentStoragesRef.current = [];
      backgroundLayersRef.current = [];
      agentLayersRef.current = [];
    };
  }, [environment, updateTrigger, assetRevision, handleAgentClick, resolveSceneBounds, scenario]);

  const resetView = useCallback(() => {
    envViewRef.current?.fitToScene({ padding: 0 });
  }, []);

  useEffect(() => {
    const bounds = resolveSceneBounds();
    if (!bounds) return;
    backgroundLayersRef.current.forEach((layer) => layer.setSceneBounds(bounds));
    agentLayersRef.current.forEach((layer) => layer.setSceneBounds(bounds));
  }, [resolveSceneBounds, updateTrigger]);

  return (
    <div className={styles.container}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <button className={styles.resetButton} onClick={resetView}>
        <Trans>Reset View</Trans>
      </button>
      <AgentDetailsDialog
        agentType='grid'
        agent={selectedAgent}
        resolveAssetUrl={(assetId) => scenario?.assets.getUrl(assetId)}
        onClose={() => setSelectedAgent(null)}
      />
    </div>
  );
}
