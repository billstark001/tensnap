/**
 * cases/createWebScenarioCase.ts
 *
 * Shared factory for web-scenario benchmark cases.
 *
 * Eliminates the near-identical duplication between schellingScenario.ts and
 * wolfSheepScenario.ts by extracting:
 *   - Scenario instance creation & event wiring
 *   - EnvironmentRendererController lifecycle (with resolveAssetUrl injection)
 *   - LineChartView lazy-create / update / destroy
 *   - Session attach / open / state_sync
 *   - Tick dispatcher ("action_start: step")
 *   - Teardown
 *
 * The factory also injects the missing `resolveAssetUrl` callback (which
 * delegates to Scenario.assets.getUrl) so that agent layers using `asset:`
 * icons correctly resolve to blob URLs.  This fixes wolf-sheep icon
 * rendering in benchmark (see layer-registry-event-loop-audit-2026-05-06.md).
 *
 * An asset-update listener is wired so that the environment view is
 * re-rendered when asset data arrives after the initial state_sync.
 */

import { Scenario } from '@tensnap/core/scenario';
import { EnvironmentRendererController } from '@tensnap/core/scenario/browser';
import { LineChartView } from '@tensnap/core/chart/browser';
import type { SimulatorToRendererMessage } from '@tensnap/core';
import type { ChartGroupMetadata, ChartDataPoint, LineConfig } from '@tensnap/core';
import type { SimulatorSession } from '@tensnap/js/runtime';
import type { BenchmarkCase } from '../types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WebScenarioConfig {
  envWidth: number;
  envHeight: number;
  chartWidth: number;
  chartHeight: number;
  /** Optional CSS background-color for the environment container. */
  envBackground?: string;
  // Allow additional model-specific config keys.
  [key: string]: unknown;
}

export interface WebScenarioHooks {
  /** Return a display name for the benchmark case. */
  name: string;
  /** Create a @tensnap/js session with the given raw model config. */
  createSession(modelConfig: Record<string, unknown>): SimulatorSession;
  /** Optionally transform the model config before passing to createSession. */
  buildModelConfig?(partial: Record<string, unknown>): Record<string, unknown>;
  /** Optionally transform / extend the full config (model+display). */
  buildLayoutConfig?(partial: Record<string, unknown>, modelConfig: Record<string, unknown>): WebScenarioConfig;
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let caseCounter = 0;

export function createWebScenarioCase(
  partial: Record<string, unknown> = {},
  hooks: WebScenarioHooks,
): BenchmarkCase {
  const caseId = `${hooks.name.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}-${++caseCounter}`;

  const modelConfig = hooks.buildModelConfig?.(partial) ?? { ...partial };
  const cfg = hooks.buildLayoutConfig?.(partial, modelConfig) ?? {
    envWidth: (partial.envWidth as number) ?? 600,
    envHeight: (partial.envHeight as number) ?? 600,
    chartWidth: (partial.chartWidth as number) ?? 600,
    chartHeight: (partial.chartHeight as number) ?? 200,
    envBackground: partial.envBackground as string | undefined,
  };

  let host: HTMLElement | null = null;
  let envContainer: HTMLDivElement | null = null;
  let chartsContainer: HTMLDivElement | null = null;
  let envController: EnvironmentRendererController | null = null;
  const chartViews = new Map<string, LineChartView>();
  let scenario: Scenario | null = null;
  let session: SimulatorSession | null = null;

  /** Resolve an asset ID via the Scenario's AssetStore. */
  const resolveAssetUrl = (assetId: string): string | undefined => {
    return scenario?.assets.getUrl(assetId);
  };

  const rebuildEnvView = () => {
    if (!scenario || !envContainer) return;
    const env = [...scenario.environments.values()][0];
    if (!env) return;
    if (!envController) {
      envController = new EnvironmentRendererController(envContainer, {
        resolveAssetUrl,
      });
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
    name: hooks.name,
    suite: 'web-scenario' as const,
    config: cfg as unknown as Record<string, unknown>,

    async setup(container) {
      host = document.createElement('div');
      host.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
      container.appendChild(host);

      envContainer = document.createElement('div');
      const bgStyle = cfg.envBackground ? `background:${cfg.envBackground};` : '';
      envContainer.style.cssText = `width:${cfg.envWidth}px;height:${cfg.envHeight}px;overflow:hidden;border:1px solid #ccc;${bgStyle}`;
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

      // When asset data arrives, re-render so icons resolve correctly.
      // This is especially important for wolf-sheep which uses `asset:` icon
      // IDs that are resolved after asset_data flows through scenario.apply().
      const onAssetChange: () => void = () => rebuildEnvView();
      scenario.addEventListener('asset:data', onAssetChange);

      // Create chart views lazily when the model announces chart groups.
      scenario.addEventListener('chart:create', (e) => {
        ensureChartView((e as CustomEvent<ChartGroupMetadata>).detail);
      });

      // Flush chart data after every chart update.
      scenario.addEventListener('chart:update', () => flushChartUpdates());

      session = hooks.createSession(modelConfig);
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

      // (dev) Basic validation log: check if agent layers are populated.
      if (process.env.NODE_ENV === 'development' || process.env.DEBUG) {
        const env = [...scenario.environments.values()][0];
        if (env) {
          const agentCount = [...env.layers.values()].filter(
            (l: { layerType: string }) => l.layerType === 'agent'
          ).length;
          // eslint-disable-next-line no-console
          console.log(`[benchmark] ${caseId}: setup complete, agent layers: ${agentCount}`);
        }
      }
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