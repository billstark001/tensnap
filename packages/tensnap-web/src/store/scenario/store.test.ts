import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createScenarioStore } from './store';

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
});