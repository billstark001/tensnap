/**
 * cases/wolfSheepScenario.ts
 *
 * Web-scenario benchmark: Wolf-Sheep Predation Model powered by
 * the canonical @tensnap/js session and the standard Scenario rendering
 * pipeline from @tensnap/core.
 *
 * All protocol messages are routed through Scenario.apply() so that
 * environment layers and chart storage are maintained by the same code
 * path the web application uses.  EnvironmentRendererController reconciles
 * the EnvironmentView using createRenderPlan — identical to the web renderer.
 *
 * This case must NOT use the benchmark-local rAF gate; the runner
 * skips the frame yield for suite === 'web-scenario'.
 */

import { Scenario } from '@tensnap/core/scenario';
import { EnvironmentRendererController } from '@tensnap/core/scenario/browser';
import { LineChartView } from '@tensnap/core/chart/browser';
import type { SimulatorToRendererMessage } from '@tensnap/core';
import type { ChartGroupMetadata, ChartDataPoint, LineConfig } from '@tensnap/core';
import type { SimulatorSession } from '@tensnap/js/runtime';
import { WOLF_SHEEP_EXAMPLE } from '@tensnap/examples-js';
import type { WolfSheepConfig } from '@tensnap/examples-js/models';
import type { BenchmarkCase } from '../types';

interface BenchmarkConfig {
  modelVersion?: WolfSheepConfig['modelVersion'];
  initialNumberSheep?: number;
  initialNumberWolves?: number;
  sheepGainFromFood?: number;
  wolfGainFromFood?: number;
  grassRegrowthTime?: number;
  sheepReproduce?: number;
  wolfReproduce?: number;
  showEnergy?: boolean;
  gridWidth?: number;
  gridHeight?: number;
  envWidth?: number;
  envHeight?: number;
  chartWidth?: number;
  chartHeight?: number;
}

/** Build a LineChartView config from a chart group's metadata dictionary. */
function buildChartConfig(meta: ChartGroupMetadata): LineConfig[] {
  const entries = meta.dataList?.length
    ? meta.dataList
    : [{ id: meta.id, label: meta.label, color: meta.color }];
  return entries.map((m) => ({
    key: m.id,
    name: m.label,
    color: m.color,
    strokeWidth: 2,
  }));
}

let caseCounter = 0;

export function createWolfSheepScenarioCase(partial: BenchmarkConfig = {}): BenchmarkCase {
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

  const caseId = `wolf-sheep-scenario-${++caseCounter}`;
  let host: HTMLElement | null = null;
  let envContainer: HTMLDivElement | null = null;
  let chartsContainer: HTMLDivElement | null = null;
  let envController: EnvironmentRendererController | null = null;
  const chartViews = new Map<string, LineChartView>();
  let scenario: Scenario | null = null;
  let session: SimulatorSession | null = null;

  const rebuildEnvView = () => {
    if (!scenario || !envContainer) return;
    // Pick the first environment; Wolf-Sheep only ever has one.
    const env = [...scenario.environments.values()][0];
    if (!env) return;
    if (!envController) {
      envController = new EnvironmentRendererController(envContainer);
    }
    envController.render(env);
  };

  const ensureChartView = (meta: ChartGroupMetadata) => {
    if (!chartsContainer || chartViews.has(meta.id)) return;
    const div = document.createElement('div');
    div.style.cssText = `width:${cfg.chartWidth}px;height:${cfg.chartHeight}px;overflow:hidden;border:1px solid #ccc;`;
    chartsContainer.appendChild(div);
    const lines = buildChartConfig(meta);
    const view = new LineChartView(div, {
      lines,
      showGrid: true,
      showXAxis: true,
      showYAxis: true,
      showLegend: true,
      showTooltip: false,
    });
    chartViews.set(meta.id, view);
  };

  const flushChartUpdates = () => {
    if (!scenario) return;
    for (const [groupId, view] of chartViews) {
      const group = scenario.charts.getGroup(groupId);
      if (group) {
        view.updateData(group.data as ChartDataPoint[]);
      }
    }
  };

  return {
    name: 'Wolf-Sheep Predation Model (web-scenario)',
    suite: 'web-scenario' as const,
    config: cfg as unknown as Record<string, unknown>,

    async setup(container) {
      host = document.createElement('div');
      host.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
      container.appendChild(host);

      envContainer = document.createElement('div');
      envContainer.style.cssText = `width:${cfg.envWidth}px;height:${cfg.envHeight}px;overflow:hidden;border:1px solid #ccc;background:#D2B48C;`;
      host.appendChild(envContainer);

      chartsContainer = document.createElement('div');
      chartsContainer.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
      host.appendChild(chartsContainer);

      scenario = new Scenario();

      // Rebuild env view when layer structure changes.
      const onLayerChange: EventListener = () => rebuildEnvView();
      scenario.addEventListener('env:create', onLayerChange);
      scenario.addEventListener('layer:create', onLayerChange);
      scenario.addEventListener('layer:update', onLayerChange);

      // Create chart views lazily when the model announces chart groups.
      scenario.addEventListener('chart:create', (e) => {
        ensureChartView((e as CustomEvent<ChartGroupMetadata>).detail);
      });

      // Flush chart data after every chart update.
      scenario.addEventListener('chart:update', () => flushChartUpdates());

      session = WOLF_SHEEP_EXAMPLE.createSession(modelConfig);
      session.attach((message) => {
        scenario!.apply(message as SimulatorToRendererMessage);
      }, caseId);

      await session.open(caseId);
      await session.dispatch({
        type: 'state_sync',
        payload: { parameters: [], actions: [], envs: [], charts: [], request_id: `${caseId}-init` },
      });

      // Ensure the initial env view is rendered after state sync completes.
      rebuildEnvView();
    },

    async tick() {
      if (!session) {
        throw new Error('Benchmark session is not initialized.');
      }
      await session.dispatch({ type: 'action_start', payload: { id: 'step', continuous: false } });
    },

    teardown() {
      session?.close();
      envController?.destroy();
      chartViews.forEach((v) => v.destroy());
      chartViews.clear();
      host?.remove();
      session = null;
      scenario = null;
      host = null;
      envContainer = null;
      chartsContainer = null;
      envController = null;
    },
  };
}

export const wolfSheepScenarioVariations = [
  createWolfSheepScenarioCase({
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
  createWolfSheepScenarioCase({
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
  createWolfSheepScenarioCase({
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
