import { describe, expect, it, vi } from 'vitest';
import { modelBuilder } from './index';
import { mapAgentLayerOptions, matrixAgentLayerOptions } from './agent-layers';
import { projectFields } from './fields';
import type { LayerOptions } from './types';
import type { SimulatorToRendererMessage } from '@tensnap/protocol';

describe('projection ownership', () => {
  it('standalone built-in projectors own nested fields unless explicitly disabled', () => {
    const item = { id: 'a', data: { values: [0], bytes: new Uint8Array([1]) } };
    const own = projectFields({ id: 'id', data: 'data' });
    const borrow = projectFields({ id: 'id', data: 'data' }, false);
    const published = own(undefined, item);
    const borrowed = borrow(undefined, item);
    item.data.values[0] = 1;
    item.data.bytes[0] = 2;
    expect(published).toMatchObject({ data: { values: [0], bytes: new Uint8Array([1]) } });
    expect(borrowed.data).toBe(item.data);
    expect(own.ownsValues).toBe(true);
    expect(borrow.ownsValues).toBe(false);
  });

  it.each(['builtin', 'boundary', 'custom', 'changes', 'owned', 'double', 'borrow'] as const)(
    '%s respects the projector and publication copy policy',
    async (mode) => {
      const model = { agent: { id: 'a', data: { ownerTag: 'test', count: 0 } } };
      const binding = modelBuilder(
        { id: 'ownership', name: 'Ownership', description: 'copy policy' },
        {
          defaults: {},
          create: () => model,
          step: () => {
            model.agent.data.count++;
          },
        },
      );
      const options: LayerOptions<typeof model, typeof model.agent> = {
        type: 'agent',
        items: (m) => [m.agent],
        ...(mode === 'custom' ? { project: (_m, item) => item } : {}),
        ...(mode === 'changes'
          ? {
              revision: () => model.agent.data.count,
              changes: () => ({
                revision: model.agent.data.count,
                changes: [{ operation: 'update' as const, key: 'a', record: model.agent }],
              }),
            }
          : {}),
        ...(mode === 'owned'
          ? {
              project: (_m, item) => ({ id: item.id, data: { ...item.data } }),
              projectorOwnsValues: true,
            }
          : {}),
        ...(mode === 'boundary' ? { projectorDeepCopy: false } : {}),
        ...(mode === 'double' ? { deepCopy: true } : {}),
        ...(mode === 'borrow' ? { deepCopy: false, projectorDeepCopy: false } : {}),
      };
      binding.env('main').layer('agents', options);
      const session = binding.build().createSession();
      const messages: SimulatorToRendererMessage[] = [];
      session.attach((message) => {
        messages.push(message);
      });
      await session.open();
      const clone = vi.spyOn(globalThis, 'structuredClone');
      try {
        await session.dispatch({
          type: 'state_sync',
          payload: {
            request_id: 'sync',
            model_id: 'ownership',
            parameters: [],
            actions: [],
            envs: [],
            charts: [],
            monitors: [],
          },
        });
        const copies = clone.mock.calls.filter(
          ([value]) => value && typeof value === 'object' && 'ownerTag' in value,
        );
        expect(copies).toHaveLength(
          mode === 'double' ? 2 : mode === 'owned' || mode === 'borrow' ? 0 : 1,
        );
        const initial = messages.find((message) => message.type === 'item_create');
        expect(initial).toBeDefined();
        messages.length = 0;
        await session.dispatch({
          type: 'action_invoke',
          payload: { id: 'step', request_id: 'step' },
        });
        expect(initial).toMatchObject({
          payload: { items: [{ data: { count: mode === 'borrow' ? 1 : 0 } }] },
        });
        expect(messages.some((message) => message.type === 'item_update')).toBe(mode !== 'borrow');
        const update = messages.find((message) => message.type === 'item_update');
        model.agent.data.count++;
        if (update) expect(update).toMatchObject({ payload: { items: [{ data: { count: 1 } }] } });
      } finally {
        clone.mockRestore();
        await session.close();
      }
    },
  );

  it('owns source-injected values even when a custom callback promises independent fields', () => {
    const value = { count: 0 };
    const model = { map: new Map([['a', value]]), cells: [[value]] };
    const map = mapAgentLayerOptions({
      source: (m: typeof model) => m.map,
      project: () => ({ color: 'red' }),
      projectorOwnsValues: true,
    });
    const matrix = matrixAgentLayerOptions({
      source: (m: typeof model) => m.cells,
      project: () => ({ color: 'red' }),
      projectorOwnsValues: true,
    });
    const first = [map, matrix].map(
      (layer) => layer.items!(model, { phase: 'sync', full: true })[0],
    );
    value.count = 1;
    for (const record of first) expect(record).toMatchObject({ data: { value: { count: 0 } } });
  });
});

describe('incremental built-in materialization', () => {
  it.each(['identity', 'fields', 'map', 'matrix'] as const)(
    '%s reuses unchanged nested values and detaches before another selector runs',
    async (kind) => {
      const first = { id: 'a', x: 0, data: { ownerTag: 'reuse', counts: [0] } };
      const second = { id: 'b', x: 0, data: { ownerTag: 'reuse', counts: [0] } };
      let mutateEarlier = false;
      let reads = 0;
      const model = {
        items: [first, second],
        map: new Map([
          ['a', first.data],
          ['b', second.data],
        ]),
        matrix: [[first.data, second.data]],
      };
      const data = (item: typeof first) => {
        reads++;
        if (mutateEarlier && item.id === 'b') first.data.counts[0] = 9;
        return item.data;
      };
      const binding = modelBuilder(
        { id: 'reuse', name: 'Reuse', description: 'Reuse' },
        { defaults: {}, create: () => model, step: () => {} },
      );
      const environment = binding.env('main');
      if (kind === 'map') environment.mapAgentLayer('items', { source: (m) => m.map });
      else if (kind === 'matrix')
        environment.matrixAgentLayer('items', { source: (m) => m.matrix });
      else
        environment.agentLayer('items', {
          items: (m) => m.items,
          ...(kind === 'fields' ? { fields: { id: 'id', x: 'x', data } } : {}),
        });
      const session = binding.build().createSession();
      const frames: SimulatorToRendererMessage[] = [];
      session.attach((frame) => {
        frames.push(frame);
      });
      await session.open();
      await session.dispatch({
        type: 'state_sync',
        payload: {
          request_id: 'sync',
          model_id: 'reuse',
          parameters: [],
          actions: [],
          envs: [],
          charts: [],
          monitors: [],
        },
      });
      const initial = frames.find((frame) => frame.type === 'item_create');
      const clone = vi.spyOn(globalThis, 'structuredClone');
      const step = () =>
        session.dispatch({ type: 'action_invoke', payload: { id: 'step', request_id: 'step' } });
      try {
        frames.length = 0;
        reads = 0;
        await step();
        expect(clone.mock.calls).toHaveLength(0);
        expect(frames.some((frame) => frame.type === 'item_update')).toBe(false);
        if (kind === 'fields') expect(reads).toBe(2);
        first.x = 1;
        await step();
        expect(clone.mock.calls).toHaveLength(0);
        first.data.counts[0] = 1;
        mutateEarlier = kind === 'fields';
        frames.length = 0;
        await step();
        expect(clone.mock.calls).toHaveLength(1);
        const update = frames.find((frame) => frame.type === 'item_update');
        expect(update).toBeDefined();
        if (kind === 'fields' || kind === 'identity') {
          expect(initial).toMatchObject({
            payload: {
              items: expect.arrayContaining([
                expect.objectContaining({ data: expect.objectContaining({ counts: [0] }) }),
              ]),
            },
          });
          expect(update).toMatchObject({ payload: { items: [{ data: { counts: [1] } }] } });
        } else {
          expect(initial).toMatchObject({
            payload: {
              items: expect.arrayContaining([
                expect.objectContaining({
                  data: expect.objectContaining({
                    value: expect.objectContaining({ counts: [0] }),
                  }),
                }),
              ]),
            },
          });
          expect(update).toMatchObject({
            payload: { items: [{ data: { value: { counts: [1] } } }] },
          });
        }
      } finally {
        clone.mockRestore();
        await session.close();
      }
    },
  );
});

it('keeps independent projections and eager ordering for a custom key callback', async () => {
  const model = {
    items: [
      { id: 'a', data: { count: 0 } },
      { id: 'b', data: { count: 0 } },
    ],
  };
  const builder = modelBuilder(
    { id: 'keys', name: 'Keys', description: 'Keys' },
    { defaults: {}, create: () => model },
  );
  builder.env('main').agentLayer('items', {
    items: (m) => m.items,
    fields: { id: 'id', data: 'data' },
    key: (item, record) => {
      if (item.id === 'a') {
        (record.data as { count: number }).count = 7;
        model.items[1]!.data.count = 9;
      }
      return item.id;
    },
  });
  const session = builder.build().createSession();
  const frames: SimulatorToRendererMessage[] = [];
  session.attach((frame) => {
    frames.push(frame);
  });
  await session.open();
  try {
    await session.dispatch({
      type: 'state_sync',
      payload: {
        request_id: 'sync',
        model_id: 'keys',
        parameters: [],
        actions: [],
        envs: [],
        charts: [],
        monitors: [],
      },
    });
    expect(model.items[0]!.data.count).toBe(0);
    expect(frames.find((frame) => frame.type === 'item_create')).toMatchObject({
      payload: {
        items: [
          { id: 'a', data: { count: 7 } },
          { id: 'b', data: { count: 0 } },
        ],
      },
    });
  } finally {
    await session.close();
  }
});
