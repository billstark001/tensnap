import { describe, expect, it } from 'vitest';
import type { ProtocolData } from '@tensnap/protocol';
import { ValueInspector, valueInspectorText } from './index';

describe('ValueInspector', () => {
  it('keeps large branches lazy and bounded', () => {
    const inspector = new ValueInspector(
      { items: Array.from({ length: 500 }, (_, index) => ({ index })) },
      { maxEntries: 3 },
    );
    const root = inspector.inspect();
    expect(root).toMatchObject({ kind: 'tree', hasMore: false });
    const page = inspector.inspect({ path: ['items'], offset: 3 });
    expect(page).toMatchObject({
      kind: 'table',
      total: 500,
      rows: [{ index: 3 }, { index: 4 }, { index: 5 }],
      truncated: true,
    });
  });

  it('uses table rows for a record map with record values', () => {
    const content = new ValueInspector({
      alice: { score: 3 },
      bob: { score: 5, state: 'ready' },
    }).inspect({ hint: 'table' });
    expect(content).toMatchObject({
      kind: 'table',
      columns: ['key', 'score', 'state'],
      rows: [
        { key: 'alice', score: 3, state: null },
        { key: 'bob', score: 5, state: 'ready' },
      ],
    });
  });

  it('respects a one-column limit for record maps', () => {
    const content = new ValueInspector({ a: { one: 1, two: 2 } }, { maxColumns: 1 }).inspect({
      hint: 'table',
    });
    expect(content).toMatchObject({ kind: 'table', columns: ['key'], rows: [{ key: 'a' }] });
  });

  it('keeps the map key column distinct from a record field named key', () => {
    const content = new ValueInspector({ a: { key: 'inner', score: 2 } }).inspect({
      hint: 'table',
    });
    expect(content).toMatchObject({
      kind: 'table',
      columns: ['entry_key', 'key', 'score'],
      rows: [{ entry_key: 'a', key: 'inner', score: 2 }],
    });
  });

  it('falls back to bounded text for incompatible hints and nested values', () => {
    const incompatible = new ValueInspector(4).inspect({ hint: 'tree' });
    expect(incompatible).toMatchObject({ kind: 'text', reason: expect.stringContaining('tree') });
    expect(valueInspectorText('x'.repeat(20), 8)).toEqual({
      kind: 'text',
      text: 'xxxxxxx…',
      truncated: true,
    });
  });

  it('does not read array values beyond the requested page', () => {
    const values = Array.from({ length: 1_000 }, (_, index) => ({ index }));
    Object.defineProperty(values, 500, {
      get: () => {
        throw new Error('unrequested array entry was read');
      },
    });

    expect(new ValueInspector(values).inspect({ limit: 3 })).toMatchObject({
      kind: 'table',
      rows: [{ index: 0 }, { index: 1 }, { index: 2 }],
      total: 1_000,
      hasMore: true,
    });
  });

  it('indexes object keys once so later pages do not rescan the whole map', () => {
    let ownKeysCalls = 0;
    const value = new Proxy(
      {
        alpha: { score: 1 },
        beta: { score: 2 },
        gamma: { score: 3 },
      },
      {
        ownKeys(target) {
          ownKeysCalls += 1;
          return Reflect.ownKeys(target);
        },
      },
    );
    const inspector = new ValueInspector(value);

    expect(inspector.inspect({ hint: 'table', limit: 1 })).toMatchObject({
      rows: [{ key: 'alpha', score: 1 }],
    });
    expect(inspector.inspect({ hint: 'table', offset: 1, limit: 1 })).toMatchObject({
      rows: [{ key: 'beta', score: 2 }],
    });
    expect(ownKeysCalls).toBe(1);
  });

  it('stops text rendering before later unreadable values', () => {
    const values = ['x'.repeat(100), 'never read'];
    Object.defineProperty(values, 1, {
      get: () => {
        throw new Error('text formatter scanned too far');
      },
    });

    expect(valueInspectorText(values, 8)).toEqual({
      kind: 'text',
      text: '[xxxxxx…',
      truncated: true,
    });
  });

  it('does not label a shared object as a cycle', () => {
    const shared = { value: 1 };
    expect(valueInspectorText([shared, shared]).text).toBe('[{"value": 1}, {"value": 1}]');
    const cyclic: unknown[] = [];
    cyclic.push(cyclic);
    expect(valueInspectorText(cyclic).text).toContain('[Circular]');
  });

  it('stops reading object fields after the text budget is exhausted', () => {
    let reads = 0;
    const values: Record<string, unknown> = { first: 'x'.repeat(100) };
    Object.defineProperty(values, 'later', {
      enumerable: true,
      get() {
        reads++;
        return 'unused';
      },
    });
    expect(valueInspectorText(values, 8).truncated).toBe(true);
    expect(reads).toBe(0);
    const longKey = {
      get ['x'.repeat(100)]() {
        reads++;
        return 'unused';
      },
    };
    expect(valueInspectorText(longKey, 8).truncated).toBe(true);
    expect(reads).toBe(0);
  });

  it.each(['array', 'map'])('uses only own properties for %s table cells', (kind) => {
    const records: Record<string, ProtocolData>[] = [
      { constructor: 'own constructor', toString: 'own string' },
      { other: 1 },
    ];
    const root = kind === 'array' ? records : { first: records[0]!, second: records[1]! };
    const content = new ValueInspector(root).inspect({ hint: 'table' });
    expect(content.kind).toBe('table');
    if (content.kind !== 'table') return;
    expect(content.rows[1]).toMatchObject({ constructor: null, toString: null, other: 1 });
  });

  it('rejects non-integer array paths even when local arrays have extra properties', () => {
    const values = [1, 2];
    Object.defineProperty(values, '0.5', { value: 42 });
    Object.defineProperty(values, 'NaN', { value: 42 });
    const inspector = new ValueInspector(values);
    expect(inspector.valueAt([0.5])).toBeUndefined();
    expect(inspector.valueAt([NaN])).toBeUndefined();
    expect(inspector.valueAt([0])).toBe(1);
  });
});
