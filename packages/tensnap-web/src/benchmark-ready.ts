import type { StoreApi } from 'zustand';
import type { ScenarioStore } from './store/scenario/types';

type BenchmarkScenarioStore = Pick<StoreApi<ScenarioStore>, 'getState' | 'subscribe'>;

/** Wait outside the measured interval and retain the bootstrap state on failure. */
export function waitForInitialWebState(
  store: BenchmarkScenarioStore,
  timeoutMs = 10_000,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      const state = store.getState();
      const transport = state.session.attachedTransport;
      const info = state.session.simulatorInfo;
      reject(
        new Error(
          `Timed out while waiting for the web scenario to finish state sync (${timeoutMs} ms).\n` +
            `web state: ${JSON.stringify({
              connected: state.connected,
              connectionState: transport?.connectionState ?? 'detached',
              identityStatus: state.session.identityStatus,
              modelId: info?.model.id ?? null,
              instanceId: info?.instance_id ?? null,
              stateSync: state.stateSync,
              actions: state.actions.size,
              environments: state.environments.size,
              diagnostics: state.diagnostics.slice(-12).map((diagnostic) => ({
                severity: diagnostic.severity,
                domain: diagnostic.domain,
                source: diagnostic.source,
                code: diagnostic.code,
                message: diagnostic.message,
                requestId: diagnostic.requestId,
              })),
            })}`,
        ),
      );
    }, timeoutMs);
    const finishIfReady = () => {
      const state = store.getState();
      if (
        state.connected &&
        state.stateSync.phase === 'idle' &&
        state.actions.size > 0 &&
        state.environments.size > 0
      ) {
        clearTimeout(timer);
        unsubscribe();
        resolve();
      }
    };
    unsubscribe = store.subscribe(finishIfReady);
    finishIfReady();
  });
}
