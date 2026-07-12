import type { ChartConfig, ChartDataPoint, ISimulatorTransport, Scenario } from '@tensnap/core';
import type { RendererSession } from '@tensnap/core/runtime';
import { I18nProvider } from '@lingui/react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MainViewRenderer } from './components/project/MainViewRenderer';
import { CanvasChartView } from './components/chart/CanvasChartView';
import { Environment2DView } from './components/scenario/Environment2DView';
import { UniformEnvironmentView } from './components/scenario/UniformEnvironmentView';
import { i18n, initI18n } from './i18n';
import { createScenarioStore, ScenarioStoreProvider } from './store/scenario/store';
import { useSettingsStore, type RenderTriggerMode } from './store/settings';
import { createTransportStore, TransportStoreProvider } from './store/transport';
import { createHistoryStore, ScenarioUndoRedoStoreProvider } from './store/undo-redo';

export interface WebBenchmarkHostOptions {
  transport: ISimulatorTransport;
  width: number;
  height: number;
  renderTriggerMode: RenderTriggerMode;
  maxTps: number;
  maxRenderFps: number;
}

export interface MountedWebBenchmark {
  session: RendererSession;
  destroy(): void;
}

export interface MountedWebComponentBenchmark {
  destroy(): void;
}

export interface MountedWebChartBenchmark extends MountedWebComponentBenchmark {
  updateData(data: ChartDataPoint[]): void;
}

export interface WebComponentHostOptions {
  width: number;
  height: number;
}

function waitForAnimationFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitForInitialWebRender(
  store: ReturnType<typeof createScenarioStore>,
  timeoutMs = 10_000,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('Timed out while waiting for the web scenario to finish state sync.'));
    }, timeoutMs);
    const finishIfReady = () => {
      const state = store.getState();
      if (
        state.connected
        && state.stateSync.phase === 'idle'
        && state.actions.size > 0
        && state.environments.size > 0
      ) {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    };
    unsubscribe = store.subscribe(finishIfReady);
    finishIfReady();
  });

  // Let the same React effects, Leafer hosts and resize observers used by the
  // web application finish mounting before the measured run starts.
  await waitForAnimationFrame();
  await waitForAnimationFrame();
}

async function prepareComponentHost(
  container: HTMLElement,
  options: WebComponentHostOptions,
): Promise<{ host: HTMLDivElement; root: Root }> {
  useSettingsStore.setState({ theme: 'light' });
  await initI18n('en');
  const host = document.createElement('div');
  host.dataset.benchmarkHost = 'tensnap-web-component';
  host.style.width = `${options.width}px`;
  host.style.height = `${options.height}px`;
  host.style.position = 'relative';
  host.style.overflow = 'hidden';
  container.replaceChildren(host);
  return { host, root: createRoot(host) };
}

/** Mount the same React chart host used by the Web application. */
export async function mountWebChartBenchmark(
  container: HTMLElement,
  options: WebComponentHostOptions & { config: ChartConfig; initialData: ChartDataPoint[] },
): Promise<MountedWebChartBenchmark> {
  const { host, root } = await prepareComponentHost(container, options);
  let revision = 0;
  let data = options.initialData;
  const render = () => root.render(
    <CanvasChartView data={data} dataVersion={revision} config={options.config} style={{ width: '100%', height: '100%' }} />,
  );
  flushSync(render);
  await waitForAnimationFrame();
  return {
    updateData(nextData) {
      data = nextData;
      revision += 1;
      render();
    },
    destroy() {
      flushSync(() => root.unmount());
      host.remove();
    },
  };
}

/** Mount a production Web environment component without a transport. */
export async function mountWebEnvironmentBenchmark(
  container: HTMLElement,
  options: WebComponentHostOptions & { scenario: Scenario; environmentId: string; display: '2d' | 'uniform' },
): Promise<MountedWebComponentBenchmark> {
  const { host, root } = await prepareComponentHost(container, options);
  const historyStore = createHistoryStore();
  const scenarioStore = createScenarioStore(historyStore);
  const environment = options.scenario.environments.get(options.environmentId);
  if (!environment) {
    root.unmount();
    host.remove();
    throw new Error(`Benchmark environment "${options.environmentId}" was not found.`);
  }
  const view = options.display === 'uniform'
    ? <UniformEnvironmentView environment={environment} scenario={options.scenario} assets={options.scenario.assets} />
    : <Environment2DView environment={environment} scenario={options.scenario} assets={options.scenario.assets} />;
  flushSync(() => root.render(
    <I18nProvider i18n={i18n}>
      <ScenarioStoreProvider value={scenarioStore}>
        <ScenarioUndoRedoStoreProvider value={historyStore}>
          {view}
        </ScenarioUndoRedoStoreProvider>
      </ScenarioStoreProvider>
    </I18nProvider>,
  ));
  await waitForAnimationFrame();
  await waitForAnimationFrame();
  return {
    destroy() {
      flushSync(() => root.unmount());
      host.remove();
    },
  };
}

/**
 * Mount the production web host for browser benchmarks.
 *
 * This deliberately goes through the real transport store, RendererSession,
 * Zustand subscriptions, auto-layout and React view tree. Benchmark code does
 * not own a parallel renderer implementation.
 */
export async function mountWebBenchmark(
  container: HTMLElement,
  options: WebBenchmarkHostOptions,
): Promise<MountedWebBenchmark> {
  useSettingsStore.setState({
    theme: 'light',
    renderTriggerMode: options.renderTriggerMode,
    maxTps: options.maxTps,
    maxRenderFps: options.maxRenderFps,
  });
  await initI18n('en');

  const historyStore = createHistoryStore();
  const scenarioStore = createScenarioStore(historyStore);
  const transportStore = createTransportStore(scenarioStore);
  const host = document.createElement('div');
  host.dataset.benchmarkHost = 'tensnap-web';
  host.style.width = `${options.width}px`;
  host.style.height = `${options.height}px`;
  host.style.position = 'relative';
  host.style.overflow = 'hidden';
  container.replaceChildren(host);

  let root: Root | null = createRoot(host);
  flushSync(() => {
    root?.render(
      <I18nProvider i18n={i18n}>
        <ScenarioStoreProvider value={scenarioStore}>
          <TransportStoreProvider value={transportStore}>
            <ScenarioUndoRedoStoreProvider value={historyStore}>
              <MainViewRenderer />
            </ScenarioUndoRedoStoreProvider>
          </TransportStoreProvider>
        </ScenarioStoreProvider>
      </I18nProvider>,
    );
  });

  try {
    await transportStore.getState().initialize(options.transport);
    await waitForInitialWebRender(scenarioStore);
  } catch (error) {
    transportStore.getState().destroy();
    flushSync(() => root?.unmount());
    root = null;
    host.remove();
    throw error;
  }

  return {
    session: scenarioStore.getState().session,
    destroy() {
      transportStore.getState().destroy();
      flushSync(() => root?.unmount());
      root = null;
      host.remove();
    },
  };
}
