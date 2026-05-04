import type {
  AnyProtocolMessage,
  ChartUpdatePayload,
  EnvLayerCreatePayload,
  ItemCreatePayload,
  ItemDeletePayload,
  ItemUpdatePayload,
  MetadataUpdatePayload,
} from '@tensnap/core';
import {
  AgentLayer,
  AgentStorage,
  EnvironmentView,
  GridEnvStorage,
  GridLayer,
  type AgentRenderState,
  type GridEnvData,
} from '@tensnap/core/environment';
import { LineChartView, type ChartDataPoint } from '@tensnap/core/chart';
import type { WolfSheepConfig } from '../models';
import { createBundledExampleTransport } from '../entries/main-bundle';
import { dispatchBenchmarkAction, extractDeletedIds, pushChartPoint, type TransportBenchmarkCase } from './shared';

interface BenchmarkConfig extends Partial<WolfSheepConfig> {
  envWidth?: number;
  envHeight?: number;
  chartWidth?: number;
  chartHeight?: number;
}

interface WolfSheepChartPoint {
  time: number;
  sheep?: number;
  wolves?: number;
  grass?: number;
}

const GRID_LAYER = 'grid';
const TERRAIN_LAYER = 'terrain';
const ANIMAL_LAYER = 'animals';
const CHART_KEY_BY_ID: Record<string, keyof Omit<WolfSheepChartPoint, 'time'>> = {
  sheep_count: 'sheep',
  wolf_count: 'wolves',
  grass_count: 'grass',
};

function toAnimalRenderState(items: Array<Record<string, unknown>>): AgentRenderState[] {
  return items.map((item) => ({
    id: item.id as string,
    x: item.x as number,
    y: item.y as number,
    heading: item.heading as number | undefined,
    icon: 'circle',
    size: 1,
    color: String(item.icon).endsWith(':wolf-sheep:wolf') ? '#000000' : '#FFFFFF',
  }));
}

function toGrassRenderState(item: Record<string, unknown>): AgentRenderState | null {
  if (item.color !== '#67b36b') {
    return null;
  }
  return {
    id: item.id as string,
    x: item.x as number,
    y: item.y as number,
    icon: 'square',
    size: 1,
    color: '#7EC850',
  };
}

export function createWolfSheepTransportCase(partial: BenchmarkConfig = {}): TransportBenchmarkCase {
  const modelConfig: WolfSheepConfig = {
    modelVersion: partial.modelVersion ?? 'sheep-wolves-grass',
    initialNumberSheep: partial.initialNumberSheep ?? 100,
    initialNumberWolves: partial.initialNumberWolves ?? 50,
    sheepGainFromFood: partial.sheepGainFromFood ?? 4,
    wolfGainFromFood: partial.wolfGainFromFood ?? 20,
    grassRegrowthTime: partial.grassRegrowthTime ?? 30,
    sheepReproduce: partial.sheepReproduce ?? 4,
    wolfReproduce: partial.wolfReproduce ?? 5,
    showEnergy: partial.showEnergy ?? false,
    gridWidth: partial.gridWidth ?? 50,
    gridHeight: partial.gridHeight ?? 50,
  };

  const cfg = {
    ...modelConfig,
    envWidth: partial.envWidth ?? 700,
    envHeight: partial.envHeight ?? 700,
    chartWidth: partial.chartWidth ?? 700,
    chartHeight: partial.chartHeight ?? 200,
  };

  const includeGrass = modelConfig.modelVersion === 'sheep-wolves-grass';
  let host: HTMLElement | null = null;
  let view: EnvironmentView | null = null;
  let chart: LineChartView | null = null;
  let grassStorage: AgentStorage | null = null;
  let animalStorage: AgentStorage | null = null;
  let gridStorage: GridEnvStorage | null = null;
  let chartData: WolfSheepChartPoint[] = [];
  let currentTime = 0;
  let transport: ReturnType<typeof createBundledExampleTransport> | null = null;

  const applyChartUpdate = (payload: ChartUpdatePayload) => {
    if (payload.operations?.some((operation) => operation.operation === 'clear')) {
      chartData = [];
    }
    for (const update of payload.updates ?? []) {
      const key = CHART_KEY_BY_ID[update.id];
      if (!key || typeof update.value !== 'number') {
        continue;
      }
      chartData = pushChartPoint(chartData, update.time ?? currentTime, { [key]: update.value } as Partial<WolfSheepChartPoint>);
    }
    chart?.updateData(chartData as ChartDataPoint[]);
  };

  const syncGrassItems = (items: Array<Record<string, unknown>>) => {
    if (!grassStorage) {
      return;
    }
    const toAdd: AgentRenderState[] = [];
    const toUpdate: AgentRenderState[] = [];
    const toRemove: string[] = [];

    for (const item of items) {
      const next = toGrassRenderState(item);
      const id = String(item.id);
      if (next) {
        if (grassStorage.hasAgent(id)) {
          toUpdate.push(next);
        } else {
          toAdd.push(next);
        }
      } else if (grassStorage.hasAgent(id)) {
        toRemove.push(id);
      }
    }

    if (toAdd.length > 0) {
      grassStorage.addAgents(toAdd);
    }
    if (toUpdate.length > 0) {
      grassStorage.updateAgents(toUpdate);
    }
    if (toRemove.length > 0) {
      grassStorage.removeAgents(toRemove);
    }
  };

  const onMessage = (message: AnyProtocolMessage) => {
    switch (message.type) {
      case 'metadata_update': {
        const payload = message.payload as MetadataUpdatePayload;
        if (typeof payload.time === 'number') {
          currentTime = payload.time;
        }
        break;
      }
      case 'env_layer_create': {
        const payload = message.payload as EnvLayerCreatePayload;
        if (payload.layer_id === GRID_LAYER && payload.data) {
          gridStorage?.setData(payload.data as GridEnvData);
        }
        break;
      }
      case 'item_create': {
        const payload = message.payload as ItemCreatePayload;
        if (payload.layer_id === TERRAIN_LAYER) {
          syncGrassItems(payload.items as Array<Record<string, unknown>>);
        }
        if (payload.layer_id === ANIMAL_LAYER) {
          animalStorage?.addAgents(toAnimalRenderState(payload.items as Array<Record<string, unknown>>));
        }
        break;
      }
      case 'item_update': {
        const payload = message.payload as ItemUpdatePayload;
        if (payload.layer_id === TERRAIN_LAYER) {
          syncGrassItems(payload.items as Array<Record<string, unknown>>);
        }
        if (payload.layer_id === ANIMAL_LAYER) {
          animalStorage?.updateAgents(toAnimalRenderState(payload.items as Array<Record<string, unknown>>));
        }
        break;
      }
      case 'item_delete': {
        const payload = message.payload as ItemDeletePayload;
        if (payload.layer_id === TERRAIN_LAYER) {
          grassStorage?.removeAgents(extractDeletedIds(payload.items as unknown[]));
        }
        if (payload.layer_id === ANIMAL_LAYER) {
          animalStorage?.removeAgents(extractDeletedIds(payload.items as unknown[]));
        }
        break;
      }
      case 'chart_update': {
        applyChartUpdate(message.payload as ChartUpdatePayload);
        break;
      }
      default:
        break;
    }
  };

  return {
    name: 'Wolf-Sheep Predation Model',
    config: cfg as Record<string, unknown>,

    async setup(container) {
      host = document.createElement('div');
      host.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
      container.appendChild(host);

      const envContainer = document.createElement('div');
      envContainer.style.cssText = `width:${cfg.envWidth}px;height:${cfg.envHeight}px;overflow:hidden;border:1px solid #ccc;background:#D2B48C;`;
      host.appendChild(envContainer);

      const chartContainer = document.createElement('div');
      chartContainer.style.cssText = `width:${cfg.chartWidth}px;height:${cfg.chartHeight}px;overflow:hidden;border:1px solid #ccc;`;
      host.appendChild(chartContainer);

      view = new EnvironmentView(envContainer, { throttleMs: 0 });
      gridStorage = new GridEnvStorage();
      const gridLayer = new GridLayer(view, gridStorage);
      gridLayer.setZIndex(15);
      view.addLayer(gridLayer);

      if (includeGrass) {
        grassStorage = new AgentStorage();
        const grassLayer = new AgentLayer(view, grassStorage, {
          clickable: false,
          sceneBounds: { width: modelConfig.gridWidth, height: modelConfig.gridHeight },
        });
        grassLayer.setZIndex(10);
        view.addLayer(grassLayer);
      }

      animalStorage = new AgentStorage();
      const animalLayer = new AgentLayer(view, animalStorage, {
        clickable: false,
        coordOffset: 'float',
        sceneBounds: { width: modelConfig.gridWidth, height: modelConfig.gridHeight },
      });
      animalLayer.setZIndex(20);
      view.addLayer(animalLayer);
      view.fitToScene({ padding: 0.05 });

      chart = new LineChartView(chartContainer, {
        lines: [
          { key: 'sheep', name: 'Sheep', color: '#FFFFFF', strokeWidth: 2 },
          { key: 'wolves', name: 'Wolves', color: '#000000', strokeWidth: 2 },
          ...(includeGrass ? [{ key: 'grass', name: 'Grass', color: '#7EC850', strokeWidth: 2 }] : []),
        ],
        showGrid: true,
        showXAxis: true,
        showYAxis: true,
        showLegend: true,
        showTooltip: false,
      });

      transport = createBundledExampleTransport('wolf-sheep', {
        mode: 'inmemory',
        config: modelConfig,
      });
      transport.on('message', onMessage);
      await transport.connect();
    },

    async tick() {
      if (!transport) {
        throw new Error('Benchmark transport is not initialized.');
      }
      await dispatchBenchmarkAction(transport, 'step');
    },

    teardown() {
      transport?.off('message', onMessage);
      transport?.destroy();
      view?.destroy();
      chart?.destroy();
      host?.remove();
      transport = null;
      host = null;
      view = null;
      chart = null;
      grassStorage = null;
      animalStorage = null;
      gridStorage = null;
      chartData = [];
      currentTime = 0;
    },
  };
}

export const wolfSheepVariations = [
  createWolfSheepTransportCase({
    gridWidth: 30,
    gridHeight: 30,
    initialNumberSheep: 50,
    initialNumberWolves: 25,
    sheepGainFromFood: 4,
    wolfGainFromFood: 20,
    grassRegrowthTime: 30,
    envWidth: 500,
    envHeight: 500,
  }),
  createWolfSheepTransportCase({
    gridWidth: 50,
    gridHeight: 50,
    initialNumberSheep: 400,
    initialNumberWolves: 150,
    sheepGainFromFood: 4,
    wolfGainFromFood: 20,
    grassRegrowthTime: 30,
    envWidth: 700,
    envHeight: 700,
  }),
  createWolfSheepTransportCase({
    gridWidth: 100,
    gridHeight: 100,
    initialNumberSheep: 800,
    initialNumberWolves: 400,
    sheepGainFromFood: 4,
    wolfGainFromFood: 20,
    grassRegrowthTime: 25,
    envWidth: 900,
    envHeight: 900,
  }),
];