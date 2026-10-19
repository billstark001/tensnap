import { expect, it, vi } from 'vitest';
import { Scenario } from '@tensnap/core';
import { createAgentInspectionSource } from './agent-inspection-source';

function fixture(count: number) {
  const scenario = new Scenario();
  scenario.apply({ type: 'env_create', payload: { id: 'world', type: '2d' } });
  scenario.apply({
    type: 'env_layer_create',
    payload: {
      env_id: 'world',
      layer_id: 'agents',
      layer_type: 'agent',
      metadata: { coord_offset: 'float' },
    },
  });
  scenario.apply({
    type: 'item_create',
    payload: {
      env_id: 'world',
      layer_id: 'agents',
      items: Array.from({ length: count }, (_, id) => ({
        id,
        x: id ? 100 + id : 0,
        y: id ? 100 : 0,
      })),
    },
  });
  return scenario;
}
const ref = { environmentId: 'world', layerId: 'agents', agentId: 0 };
it('does not dump or transfer the full model; projected payload is independent of distant population', async () => {
  const sizes = [];
  for (const count of [1000, 100000]) {
    const scenario = fixture(count);
    const dump = vi.spyOn(scenario, 'dump').mockImplementation(() => {
      throw new Error('Full scene dump is forbidden for live inspection.');
    });
    const source = createAgentInspectionSource(scenario, ref);
    try {
      const result = await source.read({ radius: 3, assets: {} }, new AbortController().signal);
      expect(
        'view' in result && result.view?.scene.environments[0].layers[0].storageSnapshot,
      ).toMatchObject({ agents: [{ id: 0 }] });
      expect(dump).not.toHaveBeenCalled();
      sizes.push(JSON.stringify(result).length);
      if ('view' in result)
        expect(
          await source.read(
            { radius: 3, token: result.token, assets: {} },
            new AbortController().signal,
          ),
        ).toEqual({ unchanged: true });
    } finally {
      source.dispose();
    }
  }
  expect(sizes[1]).toBe(sizes[0]);
});
it('refreshes changed agents, honors radius changes, cancels obsolete requests and reports deletion', async () => {
  const scenario = fixture(10);
  const source = createAgentInspectionSource(scenario, ref);
  const first = await source.read({ radius: 3, assets: {} }, new AbortController().signal);
  expect('view' in first).toBe(true);
  const token = 'view' in first ? first.token : undefined;
  scenario.apply({
    type: 'item_update',
    payload: { env_id: 'world', layer_id: 'agents', items: [{ id: 0, x: 4 }] },
  });
  const changed = await source.read({ radius: 3, token, assets: {} }, new AbortController().signal);
  expect('view' in changed && changed.view?.inspection.agent.x).toBe(4);
  const controller = new AbortController();
  controller.abort();
  await expect(source.read({ radius: 9, assets: {} }, controller.signal)).rejects.toThrow();
  scenario.apply({
    type: 'item_delete',
    payload: { env_id: 'world', layer_id: 'agents', items: [0] },
  });
  expect(await source.read({ radius: 3, assets: {} }, new AbortController().signal)).toMatchObject({
    view: null,
  });
  source.dispose();
  await expect(
    source.read({ radius: 3, assets: {} }, new AbortController().signal),
  ).rejects.toThrow('closed');
});
it('sends assets only when the receiving window has not acknowledged their current hash', async () => {
  const scenario = fixture(1);
  await scenario.assets.receiveData('icon', 'image-v1', 'image/png', Uint8Array.of(1, 2));
  scenario.apply({
    type: 'item_update',
    payload: { env_id: 'world', layer_id: 'agents', items: [{ id: 0, icon: 'asset:icon' }] },
  });
  const source = createAgentInspectionSource(scenario, ref);
  const first = await source.read({ radius: 3, assets: {} }, new AbortController().signal);
  expect('view' in first && first.view?.scene.assets).toHaveLength(1);
  // A cancelled/lost response has not acknowledged its asset and must receive it again.
  const retry = await source.read({ radius: 3, assets: {} }, new AbortController().signal);
  expect('view' in retry && retry.view?.scene.assets).toHaveLength(1);
  const next = await source.read(
    { radius: 4, assets: { icon: 'image-v1' } },
    new AbortController().signal,
  );
  expect('view' in next && next.view?.scene.assets).toEqual([]);
  source.dispose();
});
