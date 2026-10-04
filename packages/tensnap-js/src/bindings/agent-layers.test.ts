import { describe, expect, it } from 'vitest';
import { mapAgentLayerOptions, matrixAgentLayerOptions } from './agent-layers';
import type { RestorableLayer } from './types';
import { modelBuilder } from './index';
import { literal } from './fields';
import type { SimulatorToRendererMessage } from '@tensnap/protocol';

const context = { phase: 'sync' as const, full: true };

describe('map and matrix agent layers', () => {
  it('uses direct selectors, constants, and visual shortcuts', () => {
    const model = { flags: new Map([['a', false]]), cells: [[1]] };
    const map = mapAgentLayerOptions({
      source: (m: typeof model) => m.flags,
      fields: { alive: 'value', label: 'key', fixed: literal('ready'), heading: 0 },
      icon: 'square',
      size: 1,
    });
    expect(map.items!(model, context)[0]).toMatchObject({
      alive: false,
      label: 'a',
      fixed: 'ready',
      heading: 0,
      icon: 'square',
      size: 1,
    });
    const matrix = matrixAgentLayerOptions({
      source: (m: typeof model) => m.cells,
      fields: { raw: 'value', sourceRow: 'row' },
      color: 'navy',
    });
    expect(matrix.items!(model, context)[0]).toMatchObject({ raw: 1, sourceRow: 0, color: 'navy' });
    const objectMap = mapAgentLayerOptions({
      source: () => new Map([['a', { alive: true, levels: [3] }]]),
      fields: { alive: 'alive', level: 'levels[0]' },
    });
    expect(objectMap.items!(model, context)[0]).toMatchObject({ alive: true, level: 3 });
    expect(() =>
      mapAgentLayerOptions({
        source: (m: typeof model) => m.flags,
        fields: { color: 'value' },
        color: 'red',
      }),
    ).toThrow('declared twice');
    expect(() =>
      matrixAgentLayerOptions({
        source: (m: typeof model) => m.cells,
        project: () => ({}),
        fields: { raw: 'value' },
      }),
    ).toThrow('use project or fields');
  });

  it('projects only changed map entries and emits a keyed diff', async () => {
    let projects = 0;
    const binding = modelBuilder(
      { id: 'source-changes', name: 'Source Changes', description: 'sparse map' },
      {
        defaults: {},
        create: () => ({
          flags: new Map([
            ['a', true],
            ['b', false],
          ]),
          revision: 0,
        }),
        step(model) {
          if (model.revision === 0) model.flags.set('a', false);
          else model.flags.delete('b');
          model.revision += 1;
        },
      },
    )
      .env('main')
      .mapAgentLayer('flags', {
        source: (model) => model.flags,
        project(_model, _key, alive) {
          projects++;
          return { color: alive ? 'black' : 'white' };
        },
        revision: (model) => model.revision,
        changes: (model, previous) => ({
          revision: model.revision,
          changes:
            model.revision > (previous as number)
              ? [
                  model.revision === 1
                    ? { operation: 'update' as const, key: 'a' }
                    : { operation: 'delete' as const, key: 'b' },
                ]
              : [],
        }),
      })
      .done()
      .build();
    const messages: SimulatorToRendererMessage[] = [];
    const session = binding.createSession();
    session.attach((message) => {
      messages.push(message);
    });
    await session.open();
    await session.dispatch({
      type: 'state_sync',
      payload: {
        request_id: 'sync',
        model_id: 'source-changes',
        parameters: [],
        actions: [],
        envs: [],
        charts: [],
        monitors: [],
      },
    });
    expect(projects).toBe(2);
    messages.length = 0;
    await session.dispatch({ type: 'action_invoke', payload: { id: 'step', request_id: 'step' } });
    expect(projects).toBe(3);
    expect(messages).toContainEqual({
      type: 'item_update',
      payload: {
        env_id: 'main',
        layer_id: 'flags',
        items: [{ id: 'a', color: 'white', data: { value: false } }],
      },
    });
    messages.length = 0;
    await session.dispatch({
      type: 'action_invoke',
      payload: { id: 'step', request_id: 'delete' },
    });
    expect(projects).toBe(3);
    expect(messages).toContainEqual({
      type: 'item_delete',
      payload: {
        env_id: 'main',
        layer_id: 'flags',
        items: [{ id: 'b' }],
      },
    });
    await session.close();
  });

  it('sorts map IDs, keeps false values, and validates before replacement', () => {
    const model = {
      flags: new Map([
        ['z', false],
        ['a', true],
      ]),
    };
    const layer = mapAgentLayerOptions({ source: (m: typeof model) => m.flags });
    const items = layer.items!(model, context);
    expect(items.map((item) => item.id)).toEqual(['a', 'z']);
    expect(items[1]?.data).toEqual({ value: false });
    const invalid = {
      layer_id: 'flags',
      layer_type: 'agent',
      items: [
        { id: 'a', data: { value: true } },
        { id: 'a', data: { value: false } },
      ],
    };
    expect(() => layer.restore!.validate!(model, invalid as RestorableLayer)).toThrow('duplicate');
    expect(model.flags.get('z')).toBe(false);
    layer.restore!.replace!(model, [{ id: 'z', data: { value: false } }]);
    expect([...model.flags]).toEqual([['z', false]]);
  });

  it('keeps numeric and string map IDs distinct', () => {
    const model = {
      flags: new Map<string | number, boolean>([
        [1, false],
        ['1', true],
      ]),
    };
    const layer = mapAgentLayerOptions({ source: (m: typeof model) => m.flags });
    expect(layer.items!(model, context).map((item) => item.id)).toEqual([1, '1']);
  });

  it('maps row-major nested and flat matrices to the same coordinates', () => {
    const nested = {
      cells: [
        [1, 2],
        [3, 4],
      ],
    };
    const flat = { cells: new Int32Array([1, 2, 3, 4]) };
    const a = matrixAgentLayerOptions({ source: (m: typeof nested) => m.cells });
    const b = matrixAgentLayerOptions({
      source: (m: typeof flat) => m.cells,
      shape: () => [2, 2],
      at: (m, row, col) => m.cells[row * 2 + col]!,
    });
    expect(a.items!(nested, context)).toEqual(b.items!(flat, context));
    const items = a.items!(nested, context);
    expect(items[0]).toMatchObject({ id: 'cell:0:0', x: 0, y: 1 });
    expect(items[3]).toMatchObject({ id: 'cell:1:1', x: 1, y: 0 });
    const snapshot = {
      layer_id: 'cells',
      layer_type: 'agent',
      metadata: { width: 2, height: 2, coord_offset: 'int' },
      items,
    };
    a.restore!.validate!(nested, snapshot as unknown as RestorableLayer);
    a.restore!.replace!(nested, items as Record<string, never>[]);
    expect(nested.cells).toEqual([
      [1, 2],
      [3, 4],
    ]);
    const missing = { ...snapshot, items: items.slice(1) };
    expect(() => a.restore!.validate!(nested, missing as unknown as RestorableLayer)).toThrow(
      'missing',
    );
    expect(nested.cells).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});
