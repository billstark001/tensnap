import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScenarioStore } from './store/scenario/store';
import { waitForInitialWebState } from './benchmark-ready';

describe('initial web benchmark state', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function fixture() {
    const store = createScenarioStore();
    const state = store.getState();
    state.session.handleIncoming({
      type: 'simulator_info',
      payload: {
        protocol_version: '0.3',
        binding: { name: 'fixture', version: '0.3.0' },
        model: { id: 'benchmark-fixture' },
        instance_id: 'fixture-instance',
        capabilities: [],
      },
    });
    state.session.scenario.apply({
      type: 'action_create',
      payload: { id: 'step', label: 'Step' },
    });
    state.session.scenario.apply({ type: 'env_create', payload: { id: 'main', type: '2d' } });
    state.setConnected(true);
    return store;
  }

  it('accepts a sync completed before the readiness subscription', async () => {
    const store = fixture();
    await expect(waitForInitialWebState(store)).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    store.getState().session.destroy();
  });

  it('waits for the matching end even when actions and environments already exist', async () => {
    const store = fixture();
    store.getState().prepareStateSync('pending-sync', { autoLayoutOnComplete: false });
    const ready = waitForInitialWebState(store);
    await vi.advanceTimersByTimeAsync(9_999);
    store.getState().handleStateSyncBoundary('end', {
      request_id: 'pending-sync',
      state_revision: '1',
    });
    await expect(ready).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    store.getState().session.destroy();
  });

  it.each(['requested', 'receiving'] as const)(
    'identifies a stalled %s transaction instead of losing the request ID',
    async (phase) => {
      const store = fixture();
      store.getState().prepareStateSync('stalled-sync', { autoLayoutOnComplete: false });
      if (phase === 'receiving')
        store.getState().handleStateSyncBoundary('begin', {
          request_id: 'stalled-sync',
          model_id: 'benchmark-fixture',
          instance_id: 'fixture-instance',
          mode: 'replace',
        });
      const failure = waitForInitialWebState(store).catch((error: Error) => error);
      await vi.advanceTimersByTimeAsync(10_000);
      const error = await failure;
      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain(`"phase":"${phase}"`);
      expect(String(error)).toContain('"requestId":"stalled-sync"');
      expect(String(error)).toContain('"modelId":"benchmark-fixture"');
      expect(vi.getTimerCount()).toBe(0);
      store.getState().session.destroy();
    },
  );

  it('retains protocol errors even after the host resets its sync phase', async () => {
    const store = fixture();
    store.getState().setConnected(false);
    store.getState().appendDiagnostic({
      severity: 'error',
      domain: 'protocol',
      source: 'fixture',
      code: 'invalid_state_sync',
      message: 'Rejected unmatched state_sync_end.',
      requestId: 'failed-sync',
    });
    const failure = waitForInitialWebState(store).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(String(await failure)).toContain('invalid_state_sync');
    expect(String(await failure)).toContain('"connected":false');
    store.getState().session.destroy();
  });

  it('distinguishes an absent handshake from an incomplete replay', async () => {
    const store = createScenarioStore();
    const failure = waitForInitialWebState(store).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(String(await failure)).toContain('"identityStatus":"awaiting-info"');
    expect(String(await failure)).toContain('"actions":0,"environments":0');
    store.getState().session.destroy();
  });
});
