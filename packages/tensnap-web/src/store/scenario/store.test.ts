import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createScenarioStore } from './store';
import { createDefaultRootLayout } from '@/view/utils/create-view';

describe('scenario store updates preserve assets', () => {
  beforeEach(() => {
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
});