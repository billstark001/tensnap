import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRemoteInspection } from './useRemoteInspection';
import type { AgentInspectionSource, InspectionResponse } from './agent-inspection-source';
import { Scenario } from '@tensnap/core';
afterEach(() => vi.useRealTimers());
it('keeps one request in flight, cancels stale radius requests and clears acknowledgements for a new source', async () => {
  vi.useFakeTimers();
  const pending: { resolve: (value: InspectionResponse) => void; signal: AbortSignal }[] = [];
  const read = vi.fn(
    (_request, signal: AbortSignal) =>
      new Promise<InspectionResponse>((resolve) => pending.push({ resolve, signal })),
  );
  const source: AgentInspectionSource = { read };
  const close = vi.fn();
  const hook = renderHook(
    ({ radius, source }) => useRemoteInspection(source, radius, true, close),
    { initialProps: { radius: 3, source } },
  );
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(read).toHaveBeenCalledTimes(1);
  hook.rerender({ radius: 5, source });
  expect(pending[0].signal.aborted).toBe(true);
  expect(read).toHaveBeenCalledTimes(2);
  await act(async () => {
    pending[0].resolve({ view: null, token: 'stale' });
  });
  expect(close).not.toHaveBeenCalled();
  await act(async () => {
    pending[1].resolve({ unchanged: true });
    await vi.advanceTimersByTimeAsync(99);
  });
  expect(read).toHaveBeenCalledTimes(2);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(read).toHaveBeenCalledTimes(3);
  const secondRead = vi.fn().mockResolvedValue({ unchanged: true });
  hook.rerender({ radius: 5, source: { read: secondRead } });
  expect(pending[2].signal.aborted).toBe(true);
  expect(secondRead.mock.calls[0][0]).toEqual({ radius: 5, token: undefined, assets: {} });
  hook.unmount();
  expect(secondRead.mock.calls[0][1].aborted).toBe(true);
});

it('acknowledges received bytes only and removes superseded or deleted resources', async () => {
  vi.useFakeTimers();
  const create = vi.fn(() => `blob:${Math.random()}`),
    revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const { Scenario } = await import('@tensnap/core');
  const { createAgentInspectionSource } = await import('./agent-inspection-source');
  const scenario = new Scenario();
  scenario.apply({ type: 'env_create', payload: { id: 'world', type: '2d' } });
  scenario.apply({
    type: 'env_layer_create',
    payload: { env_id: 'world', layer_id: 'agents', layer_type: 'agent' },
  });
  scenario.apply({
    type: 'item_create',
    payload: {
      env_id: 'world',
      layer_id: 'agents',
      items: [{ id: 1, x: 0, y: 0, icon: 'asset:icon' }],
    },
  });
  await scenario.assets.receiveData('icon', 'v1', 'image/png', Uint8Array.of(65));
  const owner = createAgentInspectionSource(scenario, {
    environmentId: 'world',
    layerId: 'agents',
    agentId: 1,
  });
  const read = vi.fn(owner.read);
  const source = { read };
  const hook = renderHook(() => useRemoteInspection(source, 3, true, vi.fn()));
  try {
    await act(async () => {});
    expect(hook.result.current.scenario.assets.getHeldHashes()).toEqual({ icon: 'v1' });
    const firstURL = hook.result.current.scenario.assets.getUrl('icon');
    expect(create).toHaveBeenCalledTimes(2);
    for (let x = 1; x <= 3; x++) {
      scenario.apply({
        type: 'item_update',
        payload: { env_id: 'world', layer_id: 'agents', items: [{ id: 1, x }] },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(hook.result.current.scenario.assets.getUrl('icon')).toBe(firstURL);
      expect(create).toHaveBeenCalledTimes(2);
    }
    scenario.apply({
      type: 'asset_metadata',
      payload: { assets: [{ id: 'icon', hash: 'v1', mime: 'application/octet-stream', size: 1 }] },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(hook.result.current.scenario.assets.get('icon')?.mime).toBe('application/octet-stream');
    expect(hook.result.current.scenario.assets.getHeldHashes()).toEqual({ icon: 'v1' });
    expect(create).toHaveBeenCalledTimes(3);
    scenario.apply({
      type: 'asset_metadata',
      payload: { assets: [{ id: 'icon', hash: 'v2', mime: 'image/png', size: 1 }] },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(hook.result.current.scenario.assets.getHeldHashes()).toEqual({});
    scenario.apply({
      type: 'asset_data',
      payload: { id: 'icon', hash: 'v2', mime: 'image/png', data: Uint8Array.of(66) },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(read.mock.calls[read.mock.calls.length - 1][0].assets).toEqual({});
    expect(hook.result.current.scenario.assets.getHeldHashes()).toEqual({ icon: 'v2' });
    scenario.apply({ type: 'asset_delete', payload: { ids: ['icon'] } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(hook.result.current.scenario.assets.listMeta()).toEqual([]);
  } finally {
    hook.unmount();
    owner.dispose();
    scenario.reset({ preserveTrajectoryLayers: false });
    expect(revoke.mock.calls.length).toBe(create.mock.calls.length);
    vi.unstubAllGlobals();
  }
});

it('recovers after a transient failure with one backoff timer and stops retries on closure', async () => {
  vi.useFakeTimers();
  const read = vi
    .fn()
    .mockRejectedValueOnce(new Error('Temporary IPC error'))
    .mockResolvedValue({ unchanged: true });
  const source = { read };
  const hook = renderHook(() => useRemoteInspection(source, 3, true, vi.fn()));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(249);
  });
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(read).toHaveBeenCalledTimes(2);
  hook.unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(read).toHaveBeenCalledTimes(2);
});
it('closes rather than showing stale data forever after repeated failures', async () => {
  const { initI18n } = await import('../i18n');
  await initI18n('en');
  vi.useFakeTimers();
  const source = { read: vi.fn().mockRejectedValue(new Error('Owner unavailable')) };
  const close = vi.fn();
  const hook = renderHook(() => useRemoteInspection(source, 3, true, close));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10000);
  });
  expect(source.read).toHaveBeenCalledTimes(5);
  expect(close).toHaveBeenCalledTimes(1);
  hook.unmount();
});

it('acknowledges a revision only after the receiver successfully loads it and bounds load failures', async () => {
  const { initI18n } = await import('../i18n');
  await initI18n('en');
  vi.useFakeTimers();
  const ref = { environmentId: 'world', layerId: 'agents', agentId: 1 };
  const response: InspectionResponse = {
    token: 'revision',
    view: {
      scene: new Scenario().dump(),
      assetHashes: {},
      inspection: {
        kind: 'none',
        reason: 'uniform-environment',
        ref,
        agent: { id: 1 },
        environmentId: 'world',
        layerId: 'agents',
        radius: 3,
        neighbors: [],
        neighborCount: 0,
        edges: [],
      },
    },
  };
  const read = vi.fn().mockResolvedValue(response);
  const close = vi.fn();
  const source = { read };
  const hook = renderHook(() => useRemoteInspection(source, 3, true, close));
  const load = vi.spyOn(hook.result.current.scenario, 'load').mockImplementation(() => {
    throw new Error('Rendering resource unavailable');
  });
  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(read).toHaveBeenCalledTimes(5);
    expect(read.mock.calls.every(([request]) => request.token === undefined)).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    load.mockRestore();
    hook.unmount();
  }
});
