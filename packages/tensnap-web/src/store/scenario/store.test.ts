import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createScenarioStore } from './store';
import { createDefaultRootLayout } from '@/utils/view/create-view';
import { useSettingsStore } from '@/store/settings';
import { createHistoryStore } from '@/store/undo-redo';

describe('scenario store updates preserve assets', () => {
  beforeEach(() => {
    vi.useRealTimers();
    useSettingsStore.setState({ maxRenderFps: 0 });
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:test-asset'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('updateEnvironment does not clear resolved assets', async () => {
    const useStore = createScenarioStore();
    const state = useStore.getState();

    state.applyMessage({ type: 'env_create', payload: { id: 'env-1', type: '2d' } });
    state.applyMessage({
      type: 'env_layer_create',
      payload: {
        env_id: 'env-1',
        layer_id: 'agents',
        layer_type: 'agent',
        data: { coord_offset: 'int' },
      },
    });

    await state.scenario.assets.receiveData(
      'agent-icon',
      'hash-1',
      'image/png',
      new Uint8Array([137, 80, 78, 71]),
    );

    expect(state.scenario.assets.getUrl('agent-icon')).toBe('blob:test-asset');
    expect(state.scenario.assets.getHeldHashes()).toEqual({ 'agent-icon': 'hash-1' });

    state.updateEnvironment('env-1', { width: 32 });

    expect(state.scenario.assets.getUrl('agent-icon')).toBe('blob:test-asset');
    expect(state.scenario.assets.getHeldHashes()).toEqual({ 'agent-icon': 'hash-1' });
  });

  it('auto-applies layout when a matching sync ends on a default main view', () => {
    const useStore = createScenarioStore();
    const state = useStore.getState();

    state.applyMessage({ type: 'env_create', payload: { id: 'env-1', type: '2d' } });
    state.prepareStateSync('sync-1', { autoLayoutOnComplete: true });
    state.handleStateSyncBoundary('end', { request_id: 'sync-1' });

    expect(useStore.getState().mainView.views.length).toBeGreaterThan(0);
    expect(useStore.getState().stateSync.phase).toBe('idle');
  });

  it('does not auto-apply layout when the main view already has user content', () => {
    const useStore = createScenarioStore();
    const state = useStore.getState();

    state.applyMessage({ type: 'env_create', payload: { id: 'env-1', type: '2d' } });
    state.setMainView(createDefaultRootLayout([{
      id: 'custom-button',
      type: 'button',
      left: 10,
      top: 10,
      width: 120,
      height: 40,
      expanded: true,
      disabled: false,
      data: { id: 'custom', text: 'Custom' },
    }]));

    state.prepareStateSync('sync-2', { autoLayoutOnComplete: true });
    state.handleStateSyncBoundary('end', { request_id: 'sync-2' });

    expect(useStore.getState().mainView.views).toHaveLength(1);
    expect(useStore.getState().mainView.views[0].id).toBe('custom-button');
  });

  it('promotes the first runtime tick to one and clears the correction on reset', async () => {
    const useStore = createScenarioStore();
    const state = useStore.getState();

    state.applyMessage({ type: 'metadata_update', payload: { time: 0 } });
    await Promise.resolve();
    expect(useStore.getState().currentTime).toBe(0);

    state.applyMessage({ type: 'action_end', payload: { id: 'start' } });
    await Promise.resolve();
    expect(useStore.getState().currentTime).toBe(1);

    state.applyMessage({ type: 'metadata_update', payload: { time: 2 } });
    await Promise.resolve();
    expect(useStore.getState().currentTime).toBe(2);

    state.applyMessage({ type: 'metadata_update', payload: { time: 0 } });
    await Promise.resolve();
    expect(useStore.getState().currentTime).toBe(0);
  });

  it('limits session-driven UI commits without limiting simulator ticks', async () => {
    vi.useFakeTimers();
    useSettingsStore.setState({ maxRenderFps: 10 });
    const useStore = createScenarioStore();
    const session = useStore.getState().session;
    const initialRevision = useStore.getState()._revision;

    session.handleIncoming({ type: 'metadata_update', payload: { time: 1 } });
    await Promise.resolve();
    expect(useStore.getState()._revision).toBe(initialRevision + 1);

    session.handleIncoming({ type: 'metadata_update', payload: { time: 2 } });
    await Promise.resolve();
    expect(useStore.getState()._revision).toBe(initialRevision + 1);

    await vi.advanceTimersByTimeAsync(100);
    expect(useStore.getState()._revision).toBe(initialRevision + 2);
    expect(useStore.getState().currentTime).toBe(2);
  });

  it('records renderer layout commands while excluding live simulator updates', async () => {
    const history = createHistoryStore();
    const useStore = createScenarioStore(history);
    const original = structuredClone(useStore.getState().mainView);
    const edited = createDefaultRootLayout([{
      id: 'view-1', type: 'button', left: 1, top: 2, width: 120, height: 40,
      expanded: true, disabled: false, data: { id: 'step', text: 'Step' },
    }]);

    useStore.getState().setMainView(edited);
    expect(history.getState().past.map((command) => command.scope)).toEqual(['view-config']);
    await history.getState().undo();
    expect(useStore.getState().mainView).toEqual(original);
    await history.getState().redo();
    expect(useStore.getState().mainView).toEqual(edited);

    const commandCount = history.getState().past.length;
    useStore.getState().applyMessage({ type: 'metadata_update', payload: { time: 3 } });
    await Promise.resolve();
    expect(history.getState().past).toHaveLength(commandCount);
  });
});
