import { useRef, useEffect, useCallback, useState } from 'react';
import { AnchoredView } from '@/types/ui';
import * as styles from './Environment2DView.css';
import { AgentDetailsDialog } from '../../dialogs/AgentDetailsDialog';
import { Trans } from '@lingui/react';
import { useScenarioStore } from '@/store/scenario/store';
import { useToast } from '@/store/toast';
import {
  AgentStorage,
  AgentLayer,
  BackgroundStorage,
  BackgroundLayer,
  EdgeLayer,
  EdgeStorage,
  EnvironmentView,
  GraphEnvConfig,
  GridEnvStorage,
  GridLayer,
  TrajectoryLayer,
  TrajectoryStorage,
} from '@tensnap/core/environment';
import type { AgentRenderState } from '@tensnap/core/environment';
import { findSceneBounds as findRegisteredSceneBounds } from '@tensnap/core/scenario';
import type { ScenarioEnvironmentState } from '@tensnap/core/scenario';

interface Environment2DViewProps {
  environment: ScenarioEnvironmentState;
  updateTrigger?: number;
  view?: AnchoredView;
}

const DEFAULT_LAYER_Z_INDEX = {
  trajectory: 30,
  agent: 40,
} as const;

const storageIdentityMap = new WeakMap<object, number>();
let nextStorageIdentity = 1;

const getStorageIdentity = (storage: object): number => {
  const current = storageIdentityMap.get(storage);
  if (current !== undefined) {
    return current;
  }

  const next = nextStorageIdentity;
  nextStorageIdentity += 1;
  storageIdentityMap.set(storage, next);
  return next;
};

const getSceneBounds = (metadata: Record<string, unknown>): { width: number; height: number } | undefined => {
  const { width, height } = metadata;
  if (typeof width === 'number' && typeof height === 'number') {
    return { width, height };
  }
  return undefined;
};

export function Environment2DView({ environment, updateTrigger, view }: Environment2DViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const envViewRef = useRef<EnvironmentView | null>(null);
  const agentStoragesRef = useRef<AgentStorage[]>([]);
  const backgroundLayersRef = useRef<BackgroundLayer[]>([]);
  const agentLayersRef = useRef<AgentLayer[]>([]);

  const [selectedAgent, setSelectedAgent] = useState<AgentRenderState | null>(null);
  const scenario = useScenarioStore((store) => store.scenario);
  const toast = useToast();
  const scenarioRef = useRef(scenario);
  const toastErrorRef = useRef(toast.error);
  void updateTrigger;
  void view;

  useEffect(() => {
    scenarioRef.current = scenario;
  }, [scenario]);

  useEffect(() => {
    toastErrorRef.current = toast.error;
  }, [toast.error]);

  const layerBuildKey = [...environment.layers.values()]
    .map((layer) => {
      const metadata = (layer.metadata ?? {}) as Record<string, unknown>;
      const metadataEntries = Object.keys(metadata)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, metadata[key]] as const);
      const dependencyEntries = Object.entries(layer.dependencyLayerIds ?? {})
        .sort(([left], [right]) => left.localeCompare(right));
      return JSON.stringify({
        id: layer.id,
        layerType: layer.layerType,
        storageId: getStorageIdentity(layer.storage as object),
        dependencies: dependencyEntries,
        metadata: metadataEntries,
      });
    })
    .sort()
    .join('|');

  const handleAgentSelect = useCallback((agent: AgentRenderState) => {
    for (const storage of agentStoragesRef.current) {
      const found = storage.getAgent(agent.id);
      if (found) {
        setSelectedAgent(found as AgentRenderState);
        return;
      }
    }
    setSelectedAgent(agent as AgentRenderState);
  }, [setSelectedAgent]);

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
      const sceneBounds = findRegisteredSceneBounds(layerStates);
      const hasEdgeLayer = layerStates.some((layer) => layer.storage instanceof EdgeStorage);

      const nextAgentStorages: AgentStorage[] = [];
      const nextBackgroundLayers: BackgroundLayer[] = [];
      const nextAgentLayers: AgentLayer[] = [];
      const agentStorageByLayerId = new Map<string, AgentStorage>();
      const agentMetadataByLayerId = new Map<string, Record<string, unknown>>();
      const edgeLayerByAgentLayerId = new Map<string, EdgeLayer>();
      let implicitTrajectoryLayerZIndex = DEFAULT_LAYER_Z_INDEX.trajectory;
      let implicitAgentLayerZIndex = DEFAULT_LAYER_Z_INDEX.agent;

      for (const layer of layerStates) {
        if (layer.storage instanceof BackgroundStorage) {
          const backgroundLayer = new BackgroundLayer(
            nextView,
            layer.storage,
            sceneBounds ? { sceneBounds } : undefined,
          );
          if (typeof layer.metadata?.z_index === 'number') {
            backgroundLayer.setZIndex(layer.metadata.z_index);
          }
          nextView.addLayer(backgroundLayer);
          nextBackgroundLayers.push(backgroundLayer);
          continue;
        }

        if (layer.storage instanceof GridEnvStorage) {
          const gridLayer = new GridLayer(nextView, layer.storage);
          if (typeof layer.metadata?.z_index === 'number') {
            gridLayer.setZIndex(layer.metadata.z_index);
          }
          nextView.addLayer(gridLayer);
          continue;
        }

        if (layer.storage instanceof AgentStorage) {
          agentStorageByLayerId.set(layer.id, layer.storage);
          agentMetadataByLayerId.set(layer.id, layer.metadata as Record<string, unknown>);
          nextAgentStorages.push(layer.storage);
        }
      }

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
        const linkedAgentSceneBounds = linkedAgentMetadata
          ? getSceneBounds(linkedAgentMetadata) ?? sceneBounds
          : sceneBounds;
        const trajectoryLayer = new TrajectoryLayer(nextView, layer.storage, {
          coordOffset: linkedEdgeLayer
            ? 'float'
            : linkedAgentMetadata?.coord_offset === 'float'
              ? 'float'
              : 'int',
          worldBounds: linkedEdgeLayer ? undefined : linkedAgentSceneBounds,
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

        const layerSceneBounds = getSceneBounds(layer.metadata) ?? sceneBounds;

        const agentLayer = new AgentLayer(nextView, layer.storage, {
          ...(linkedEdgeLayer ? linkedEdgeLayer.buildDragHandlers() : {}),
          clickable: true,
          draggable: usesGraphInteraction,
          showLabel: false,
          originMode: usesGraphInteraction ? 'center' : 'bottom-left',
          coordOffset: usesGraphInteraction ? 'float' : layer.metadata.coord_offset === 'float' ? 'float' : 'int',
          sceneBounds: usesGraphInteraction ? undefined : layerSceneBounds,
          resolveAssetUrl: (assetId) => scenarioRef.current?.assets.getUrl(assetId),
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
      toastErrorRef.current('Environment render failed', error instanceof Error ? error.message : String(error));
      return;
    }
  }, [environment.id, environment, handleAgentSelect, layerBuildKey]);

  const resetView = useCallback(() => {
    const hasEdgeLayer = [...environment.layers.values()].some((layer) => layer.storage instanceof EdgeStorage);
    envViewRef.current?.fitToScene({ padding: hasEdgeLayer ? 0.05 : 0 });
  }, [environment]);

  useEffect(() => {
    const sceneBounds = findRegisteredSceneBounds([...environment.layers.values()]);
    if (!sceneBounds) {
      return;
    }
    backgroundLayersRef.current.forEach((layer) => layer.setSceneBounds(sceneBounds));
    agentLayersRef.current.forEach((layer) => layer.setSceneBounds(sceneBounds));
  }, [environment, layerBuildKey]);

  return (
    <div className={styles.container}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <button className={styles.resetButton} onClick={resetView}>
        <Trans id="environment2d.resetView" message="Reset View" />
      </button>
      <AgentDetailsDialog
        agentType="2d"
        agent={selectedAgent}
        resolveAssetUrl={(assetId) => scenarioRef.current?.assets.getUrl(assetId)}
        onClose={() => setSelectedAgent(null)}
      />
    </div>
  );
}
