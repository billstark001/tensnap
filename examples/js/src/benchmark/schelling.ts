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
  GridEnvStorage,
  GridLayer,
  type AgentRenderState,
  type GridEnvData,
} from '@tensnap/core/environment';
import { EnvironmentView } from '@tensnap/core/environment/browser';
import type { ChartDataPoint } from '@tensnap/core/chart';
import { LineChartView } from '@tensnap/core/chart/browser';
import type { SchellingConfig } from '../models';
import { createBundledExampleTransport } from '../entries/main-bundle';
import { dispatchBenchmarkAction, extractDeletedIds, pushChartPoint, type TransportBenchmarkCase } from './shared';

interface BenchmarkConfig extends Partial<SchellingConfig> {
  envWidth?: number;
  envHeight?: number;
  chartWidth?: number;
  chartHeight?: number;
}

interface SchellingChartPoint {
  time: number;
  satisfaction?: number;
  segregation?: number;
}

const AGENT_LAYER = 'agents';
const GRID_LAYER = 'grid';
const CHART_KEY_BY_ID: Record<string, keyof Omit<SchellingChartPoint, 'time'>> = {
  satisfaction_rate: 'satisfaction',
  segregation_index: 'segregation',
};

function toRenderableAgents(items: Array<Record<string, unknown>>): AgentRenderState[] {
  return items.map((item) => ({
    id: item.id as string | number,
    x: item.x as number | undefined,
    y: item.y as number | undefined,
    heading: item.heading as number | undefined,
    size: item.size as number | undefined,
    color: item.color as string | undefined,
    icon: 'circle',
  }));
}

export function createSchellingTransportCase(partial: BenchmarkConfig = {}): TransportBenchmarkCase {
  const modelConfig: SchellingConfig = {
    gridWidth: partial.gridWidth ?? 40,
    gridHeight: partial.gridHeight ?? 40,
    numAgentsType1: partial.numAgentsType1 ?? 500,
    numAgentsType2: partial.numAgentsType2 ?? 500,
    similarityThreshold: partial.similarityThreshold ?? 0.4,
    moveDistance: partial.moveDistance ?? 10,
  };

  const cfg = {
    ...modelConfig,
    envWidth: partial.envWidth ?? 600,
    envHeight: partial.envHeight ?? 600,
    chartWidth: partial.chartWidth ?? 600,
    chartHeight: partial.chartHeight ?? 200,
  };

  let host: HTMLElement | null = null;
  let view: EnvironmentView | null = null;
  let chart: LineChartView | null = null;
  let agentStorage: AgentStorage | null = null;
  let gridStorage: GridEnvStorage | null = null;
  let chartData: SchellingChartPoint[] = [];
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
      chartData = pushChartPoint(chartData, update.time ?? currentTime, { [key]: update.value } as Partial<SchellingChartPoint>);
    }
    chart?.updateData(chartData as ChartDataPoint[]);
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
        if (payload.layer_id === AGENT_LAYER) {
          agentStorage?.addAgents(toRenderableAgents(payload.items as Array<Record<string, unknown>>));
        }
        break;
      }
      case 'item_update': {
        const payload = message.payload as ItemUpdatePayload;
        if (payload.layer_id === AGENT_LAYER) {
          agentStorage?.updateAgents(toRenderableAgents(payload.items as Array<Record<string, unknown>>));
        }
        break;
      }
      case 'item_delete': {
        const payload = message.payload as ItemDeletePayload;
        if (payload.layer_id === AGENT_LAYER) {
          agentStorage?.removeAgents(extractDeletedIds(payload.items as unknown[]));
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
    name: 'Schelling Segregation Model',
    config: cfg as Record<string, unknown>,

    async setup(container) {
      host = document.createElement('div');
      host.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
      container.appendChild(host);

      const envContainer = document.createElement('div');
      envContainer.style.cssText = `width:${cfg.envWidth}px;height:${cfg.envHeight}px;overflow:hidden;border:1px solid #ccc;`;
      host.appendChild(envContainer);

      const chartContainer = document.createElement('div');
      chartContainer.style.cssText = `width:${cfg.chartWidth}px;height:${cfg.chartHeight}px;overflow:hidden;border:1px solid #ccc;`;
      host.appendChild(chartContainer);

      view = new EnvironmentView(envContainer, { throttleMs: 0 });
      agentStorage = new AgentStorage();
      gridStorage = new GridEnvStorage();

      const agentLayer = new AgentLayer(agentStorage, {
        clickable: false,
        sceneBounds: { width: modelConfig.gridWidth, height: modelConfig.gridHeight },
      });
      view.addLayer(agentLayer);

      const gridLayer = new GridLayer(gridStorage);
      view.addLayer(gridLayer);
      view.fitToScene({ padding: 0 });

      chart = new LineChartView(chartContainer, {
        lines: [
          { key: 'satisfaction', name: 'Satisfaction Rate', color: '#2ecc71', strokeWidth: 2 },
          { key: 'segregation', name: 'Segregation Index', color: '#e74c3c', strokeWidth: 2 },
        ],
        showGrid: true,
        showXAxis: true,
        showYAxis: true,
        showLegend: true,
        showTooltip: false,
      });

      transport = createBundledExampleTransport('schelling', {
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
      agentStorage = null;
      gridStorage = null;
      chartData = [];
      currentTime = 0;
    },
  };
}

export const schellingVariations = [
  createSchellingTransportCase({
    gridWidth: 30,
    gridHeight: 30,
    numAgentsType1: 400,
    numAgentsType2: 400,
    similarityThreshold: 0.8,
    moveDistance: 8,
    envWidth: 500,
    envHeight: 500,
  }),
  createSchellingTransportCase({
    gridWidth: 40,
    gridHeight: 40,
    numAgentsType1: 700,
    numAgentsType2: 700,
    similarityThreshold: 0.85,
    moveDistance: 10,
    envWidth: 600,
    envHeight: 600,
  }),
  createSchellingTransportCase({
    gridWidth: 80,
    gridHeight: 80,
    numAgentsType1: 2500,
    numAgentsType2: 2500,
    similarityThreshold: 1,
    moveDistance: 15,
    envWidth: 800,
    envHeight: 800,
  }),
  createSchellingTransportCase({
    gridWidth: 120,
    gridHeight: 120,
    numAgentsType1: 5800,
    numAgentsType2: 5800,
    similarityThreshold: 1,
    moveDistance: 15,
    envWidth: 800,
    envHeight: 800,
  }),
];