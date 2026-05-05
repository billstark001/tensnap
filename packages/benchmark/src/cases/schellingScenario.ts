/**
 * cases/schellingScenario.ts
 *
 * Web-scenario benchmark: Schelling Segregation Model powered by
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
import { SCHELLING_EXAMPLE } from '@tensnap/examples-js';
import type { BenchmarkCase } from '../types';

interface BenchmarkConfig {
  gridWidth?: number;
  gridHeight?: number;
  numAgentsType1?: number;
  numAgentsType2?: number;
  similarityThreshold?: number;
  moveDistance?: number;
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

export function createSchellingScenarioCase(partial: BenchmarkConfig = {}): BenchmarkCase {
  const modelConfig = {
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

  const caseId = `schelling-scenario-${++caseCounter}`;
  let host: HTMLElement | null = null;
  let envContainer: HTMLDivElement | null = null;
  let chartsContainer: HTMLDivElement | null = null;
  let envController: EnvironmentRendererController | null = null;
  const chartViews = new Map<string, LineChartView>();
  let scenario: Scenario | null = null;
  let session: SimulatorSession | null = null;

  const rebuildEnvView = () => {
    if (!scenario || !envContainer) return;
    // Pick the first environment; Schelling only ever has one.
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
    name: 'Schelling Segregation Model (web-scenario)',
    suite: 'web-scenario' as const,
    config: cfg as unknown as Record<string, unknown>,

    async setup(container) {
      host = document.createElement('div');
      host.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
      container.appendChild(host);

      envContainer = document.createElement('div');
      envContainer.style.cssText = `width:${cfg.envWidth}px;height:${cfg.envHeight}px;overflow:hidden;border:1px solid #ccc;`;
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

      session = SCHELLING_EXAMPLE.createSession(modelConfig);
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

export const schellingScenarioVariations = [
  createSchellingScenarioCase({
    gridWidth: 30,
    gridHeight: 30,
    numAgentsType1: 400,
    numAgentsType2: 400,
    similarityThreshold: 0.8,
    moveDistance: 8,
    envWidth: 500,
    envHeight: 500,
  }),
  createSchellingScenarioCase({
    gridWidth: 40,
    gridHeight: 40,
    numAgentsType1: 700,
    numAgentsType2: 700,
    similarityThreshold: 0.85,
    moveDistance: 10,
    envWidth: 600,
    envHeight: 600,
  }),
  createSchellingScenarioCase({
    gridWidth: 80,
    gridHeight: 80,
    numAgentsType1: 2500,
    numAgentsType2: 2500,
    similarityThreshold: 1,
    moveDistance: 15,
    envWidth: 800,
    envHeight: 800,
  }),
  createSchellingScenarioCase({
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
