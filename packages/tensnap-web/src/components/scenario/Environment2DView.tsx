import { useRef, useEffect, useCallback, useState } from 'react';
import { AnchoredView } from '@/types/ui';
import * as styles from './Environment2DView.css';
import { AgentDetailsDialog, type AnyAgent } from '../../dialogs/AgentDetailsDialog';
import { Trans } from '@lingui/react';
import { useScenarioStore } from '@/store/scenario/store';
import { useToast } from '@/store/toast';
import {
  EnvironmentView,
  AgentStorage,
  BackgroundStorage,
  AgentLayer,
  BackgroundLayer,
  GridEnvStorage,
  GridLayer,
  TrajectoryStorage,
  TrajectoryLayer,
  EdgeStorage,
  EdgeLayer,
  GraphEnvConfig,
  RenderableAgent,
  ScenarioEnvironmentState,
} from '@tensnap/core';

interface Environment2DViewProps {
  environment: ScenarioEnvironmentState;
  updateTrigger?: number;
  view?: AnchoredView;
}

export function Environment2DView({ environment, updateTrigger, view }: Environment2DViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const envViewRef = useRef<EnvironmentView | null>(null);
  const agentStoragesRef = useRef<AgentStorage[]>([]);
  const backgroundLayersRef = useRef<BackgroundLayer[]>([]);
  const agentLayersRef = useRef<AgentLayer[]>([]);

  const [selectedAgent, setSelectedAgent] = useState<AnyAgent | null>(null);
  const scenario = useScenarioStore((store) => store.scenario);
  const assetRevision = useScenarioStore((store) => store._assetRevision);
  const toast = useToast();

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

  const handleAgentSelect = useCallback((agent: RenderableAgent) => {
    for (const storage of agentStoragesRef.current) {
      const found = storage.getAgent(agent.id);
      if (found) {
        setSelectedAgent(found as AnyAgent);
        return;
      }
    }
    setSelectedAgent(agent as AnyAgent);
  }, []);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    let nextView: EnvironmentView | null = null;

    try {
      nextView = new EnvironmentView(containerRef.current, {
        type: 'design',
        enablePan: true,
        enableTouchZoom: true,
        enableWheelZoom: true,
      });
      const layerStates = [...environment.layers.values()];
      const sceneBounds = resolveSceneBounds();
      const metadataSource = layerStates.find((layer) => (
        layer.layerType === 'grid'
        || (typeof layer.metadata?.width === 'number' && typeof layer.metadata?.height === 'number')
      ));
      const viewMetadata = (metadataSource?.metadata ?? {}) as Record<string, unknown>;
      const rendererOverrides = view?.data.rendererOverrides?.environment2d;
      const showGrid = rendererOverrides?.showGrid ?? (viewMetadata.show_grid !== false);
      const backgroundColor = typeof rendererOverrides?.fallbackBackgroundColor === 'string'
        ? rendererOverrides.fallbackBackgroundColor
        : typeof viewMetadata.background_color === 'string'
          ? viewMetadata.background_color
          : null;
      const hasEdgeLayer = layerStates.some((layer) => layer.storage instanceof EdgeStorage);

      const nextAgentStorages: AgentStorage[] = [];
      const nextBackgroundLayers: BackgroundLayer[] = [];
      const nextAgentLayers: AgentLayer[] = [];
      const agentStorageByLayerId = new Map<string, AgentStorage>();
      const agentMetadataByLayerId = new Map<string, Record<string, unknown>>();
      const edgeLayerByAgentLayerId = new Map<string, EdgeLayer>();
      let implicitTrajectoryLayerZIndex = 30;
      let implicitAgentLayerZIndex = 40;

      const hasBackgroundStorage = layerStates.some((layer) => layer.storage instanceof BackgroundStorage);
      if (!hasBackgroundStorage && backgroundColor) {
        const syntheticBackgroundStorage = new BackgroundStorage();
        void syntheticBackgroundStorage.setBackground(backgroundColor);
        const backgroundLayer = new BackgroundLayer(
          nextView,
          syntheticBackgroundStorage,
          sceneBounds ? { sceneBounds } : undefined,
        );
        nextView.addLayer(backgroundLayer);
        nextBackgroundLayers.push(backgroundLayer);
      }

      for (const layer of layerStates) {
        if (layer.storage instanceof BackgroundStorage) {
          const backgroundLayer = new BackgroundLayer(
            nextView,
            layer.storage,
            sceneBounds ? { sceneBounds } : undefined,
          );
          nextView.addLayer(backgroundLayer);
          nextBackgroundLayers.push(backgroundLayer);
          continue;
        }

        if (layer.storage instanceof GridEnvStorage) {
          if (showGrid) {
            nextView.addLayer(new GridLayer(nextView, layer.storage));
          }
          continue;
        }

        if (layer.storage instanceof AgentStorage) {
          agentStorageByLayerId.set(layer.id, layer.storage);
          agentMetadataByLayerId.set(layer.id, layer.metadata as Record<string, unknown>);
          nextAgentStorages.push(layer.storage);
        }
      }

      let firstEdgeLayer: EdgeLayer | null = null;
      for (const layer of layerStates) {
        if (!(layer.storage instanceof EdgeStorage)) {
          continue;
        }
        const linkedAgentLayerId = layer.dependencyLayerIds?.agent;
        if (!linkedAgentLayerId) {
          continue;
        }
        const linkedAgentStorage = agentStorageByLayerId.get(linkedAgentLayerId);
        if (!linkedAgentStorage) {
          continue;
        }
        const edgeLayer = new EdgeLayer(nextView, layer.storage, linkedAgentStorage, layer.metadata as GraphEnvConfig);
        if (typeof layer.metadata?.z_index === 'number') {
          edgeLayer.setZIndex(layer.metadata.z_index);
        }
        nextView.addLayer(edgeLayer);
        edgeLayerByAgentLayerId.set(linkedAgentLayerId, edgeLayer);
        if (!firstEdgeLayer) {
          firstEdgeLayer = edgeLayer;
        }
      }

      for (const layer of layerStates) {
        if (!(layer.storage instanceof TrajectoryStorage)) {
          continue;
        }

        const linkedAgentLayerId = layer.dependencyLayerIds?.agent;
        if (!linkedAgentLayerId) {
          continue;
        }

        const linkedAgentMetadata = agentMetadataByLayerId.get(linkedAgentLayerId);
        const linkedEdgeLayer = edgeLayerByAgentLayerId.get(linkedAgentLayerId);
        const trajectoryLayer = new TrajectoryLayer(nextView, layer.storage, {
          coordOffset: linkedEdgeLayer
            ? 'float'
            : linkedAgentMetadata?.coord_offset === 'float'
              ? 'float'
              : 'int',
        });

        if (typeof layer.metadata?.z_index === 'number') {
          trajectoryLayer.setZIndex(layer.metadata.z_index);
        } else {
          trajectoryLayer.setZIndex(implicitTrajectoryLayerZIndex);
          implicitTrajectoryLayerZIndex += 1;
        }

        nextView.addLayer(trajectoryLayer);
      }

      for (const layer of layerStates) {
        if (!(layer.storage instanceof AgentStorage)) {
          continue;
        }

        const linkedEdgeLayer = edgeLayerByAgentLayerId.get(layer.id);
        const usesGraphInteraction = Boolean(linkedEdgeLayer);

        const layerSceneBounds = (
          typeof layer.metadata.width === 'number' && typeof layer.metadata.height === 'number'
        ) ? { width: layer.metadata.width, height: layer.metadata.height } : sceneBounds;

        const agentLayer = new AgentLayer(nextView, layer.storage, {
          ...(linkedEdgeLayer ? linkedEdgeLayer.buildDragHandlers() : {}),
          clickable: true,
          draggable: usesGraphInteraction,
          // Labels use the existing scene-unit sizing from AgentLayer; keep that
          // untouched and require labels to be explicitly enabled elsewhere.
          showLabel: false,
          originMode: usesGraphInteraction ? 'center' : 'bottom-left',
          coordOffset: usesGraphInteraction ? 'float' : layer.metadata.coord_offset === 'float' ? 'float' : 'int',
          sceneBounds: usesGraphInteraction ? undefined : layerSceneBounds,
          resolveAssetUrl: (assetId) => scenario?.assets.getUrl(assetId),
          onAgentClick: usesGraphInteraction ? undefined : handleAgentSelect,
          onAgentDoubleClick: usesGraphInteraction ? handleAgentSelect : undefined,
        });
        if (typeof layer.metadata?.z_index === 'number') {
          agentLayer.setZIndex(layer.metadata.z_index);
        } else {
          agentLayer.setZIndex(implicitAgentLayerZIndex);
          implicitAgentLayerZIndex += 1;
        }
        nextView.addLayer(agentLayer);
        nextAgentLayers.push(agentLayer);
      }

      nextView.fitToScene({ padding: hasEdgeLayer ? 0.05 : 0 });

      envViewRef.current = nextView;
      agentStoragesRef.current = nextAgentStorages;
      backgroundLayersRef.current = nextBackgroundLayers;
      agentLayersRef.current = nextAgentLayers;

      const activeView = nextView;
      return () => {
        activeView.destroy();
        envViewRef.current = null;
        agentStoragesRef.current = [];
        backgroundLayersRef.current = [];
        agentLayersRef.current = [];
      };
    } catch (error) {
      nextView?.destroy();
      envViewRef.current = null;
      agentStoragesRef.current = [];
      backgroundLayersRef.current = [];
      agentLayersRef.current = [];
      toast.error('Environment render failed', error instanceof Error ? error.message : String(error));
      return;
    }
  }, [environment, updateTrigger, assetRevision, handleAgentSelect, resolveSceneBounds, scenario, toast, view]);

  const resetView = useCallback(() => {
    const hasEdgeLayer = [...environment.layers.values()].some((layer) => layer.storage instanceof EdgeStorage);
    envViewRef.current?.fitToScene({ padding: hasEdgeLayer ? 0.05 : 0 });
  }, [environment]);

  useEffect(() => {
    const bounds = resolveSceneBounds();
    if (!bounds) {
      return;
    }
    backgroundLayersRef.current.forEach((layer) => layer.setSceneBounds(bounds));
    agentLayersRef.current.forEach((layer) => layer.setSceneBounds(bounds));
  }, [resolveSceneBounds, updateTrigger]);

  return (
    <div className={styles.container}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <button className={styles.resetButton} onClick={resetView}>
        <Trans id="environment2d.resetView" message="Reset View" />
      </button>
      <AgentDetailsDialog
        agentType="2d"
        agent={selectedAgent}
        resolveAssetUrl={(assetId) => scenario?.assets.getUrl(assetId)}
        onClose={() => setSelectedAgent(null)}
      />
    </div>
  );
}