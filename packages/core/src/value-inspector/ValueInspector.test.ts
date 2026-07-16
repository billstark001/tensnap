import { describe, expect, it } from 'vitest';
import { ValueInspector, valueInspectorText } from './index';

describe('ValueInspector', () => {
  it('keeps large branches lazy and bounded', () => {
    const inspector = new ValueInspector({ items: Array.from({ length: 500 }, (_, index) => ({ index })) }, { maxEntries: 3 });
    const root = inspector.inspect();
    expect(root).toMatchObject({ kind: 'tree', hasMore: false });
    const page = inspector.inspect({ path: ['items'], offset: 3 });
    expect(page).toMatchObject({ kind: 'table', total: 500, rows: [{ index: 3 }, { index: 4 }, { index: 5 }], truncated: true });
  });

  it('uses table rows for a record map with record values', () => {
    const content = new ValueInspector({ alice: { score: 3 }, bob: { score: 5, state: 'ready' } }).inspect({ hint: 'table' });
    expect(content).toMatchObject({
      kind: 'table',
      columns: ['key', 'score', 'state'],
      rows: [{ key: 'alice', score: 3, state: null }, { key: 'bob', score: 5, state: 'ready' }],
    });
  });

  it('falls back to bounded text for incompatible hints and nested values', () => {
    const incompatible = new ValueInspector(4).inspect({ hint: 'tree' });
    expect(incompatible).toMatchObject({ kind: 'text', reason: expect.stringContaining('tree') });
    expect(valueInspectorText('x'.repeat(20), 8)).toEqual({ kind: 'text', text: 'xxxxxxx…', truncated: true });
  });

  it('does not read array values beyond the requested page', () => {
    const values = Array.from({ length: 1_000 }, (_, index) => ({ index }));
    Object.defineProperty(values, 500, {
      get: () => { throw new Error('unrequested array entry was read'); },
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
    const value = new Proxy({
      alpha: { score: 1 },
      beta: { score: 2 },
      gamma: { score: 3 },
    }, {
      ownKeys(target) {
        ownKeysCalls += 1;
        return Reflect.ownKeys(target);
      },
    });
    const inspector = new ValueInspector(value);

    expect(inspector.inspect({ hint: 'table', limit: 1 })).toMatchObject({ rows: [{ key: 'alpha', score: 1 }] });
    expect(inspector.inspect({ hint: 'table', offset: 1, limit: 1 })).toMatchObject({ rows: [{ key: 'beta', score: 2 }] });
    expect(ownKeysCalls).toBe(1);
  });

  it('stops text rendering before later unreadable values', () => {
    const values = ['x'.repeat(100), 'never read'];
    Object.defineProperty(values, 1, {
      get: () => { throw new Error('text formatter scanned too far'); },
    });

    expect(valueInspectorText(values, 8)).toEqual({ kind: 'text', text: '[xxxxxx…', truncated: true });
  });
});
