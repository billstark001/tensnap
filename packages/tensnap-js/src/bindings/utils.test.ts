import { describe, expect, it } from 'vitest';
import { cloneItem, diffItem, getLayerKey, resolveItemKey, stableStorageKey } from './utils';

describe('item snapshots', () => {
  it('owns nested maps and arrays and detects in-place model changes', () => {
    const item = { id: 'a', data: { states: [{ count: 1 }] } };
    const previous = cloneItem(item);
    item.data.states[0]!.count = 2;
    expect(previous).toEqual({ id: 'a', data: { states: [{ count: 1 }] } });
    expect(diffItem(previous, cloneItem(item), resolveItemKey(item, item))).toEqual(item);
  });

  it('does not resend equal nested values constructed each step', () => {
    const item = { id: 1, data: { series: [1, null, false], nested: { label: 'ready' } } };
    expect(diffItem(cloneItem(item), cloneItem(item), resolveItemKey(item, item))).toBeUndefined();
  });

  it('reuses only equal owned nested fields across snapshots', () => {
    const item = { id: 1, data: { count: 1 }, style: { color: 'red' } };
    const previous = cloneItem(item);
    const current = cloneItem(item, previous);
    expect(current.data).toBe(previous.data);
    item.data.count = 2;
    const changed = cloneItem(item, current);
    expect(changed.data).toEqual({ count: 2 });
    expect(changed.data).not.toBe(item.data);
    expect(changed.style).toBe(previous.style);
    expect(previous.data).toEqual({ count: 1 });
  });

  it('preserves own __proto__ fields in updates and compound keys', () => {
    const previous = JSON.parse('{"id":1,"__proto__":"before"}');
    const current = JSON.parse('{"id":1,"__proto__":"after"}');
    const diff = diffItem(previous, current, resolveItemKey(current, current));
    expect(JSON.stringify(diff)).toBe('{"__proto__":"after","id":1}');
    const key = resolveItemKey(current, current, ['id', '__proto__']);
    expect(Object.prototype.hasOwnProperty.call(key.deleteKey, '__proto__')).toBe(true);
    expect(key.storageKey).not.toBe(
      resolveItemKey(previous, previous, ['id', '__proto__']).storageKey,
    );
  });
});

describe('binding identity keys', () => {
  it('keeps primitive key types distinct', () => {
    expect(stableStorageKey(1)).not.toBe(stableStorageKey('1'));
    expect(stableStorageKey('id:1')).not.toBe(stableStorageKey({ id: 1 }));
  });

  it('encodes compound fields without delimiter collisions and ignores field order', () => {
    const left = { source: 'a|target:b', target: 'c' };
    const right = { source: 'a', target: 'b|target:c' };
    expect(stableStorageKey(left)).not.toBe(stableStorageKey(right));
    expect(stableStorageKey(left)).toBe(stableStorageKey({ target: 'c', source: 'a|target:b' }));
  });

  it.each(['id', ['id']] as const)(
    'preserves numeric/string identity with selector %j',
    (selector) => {
      const numeric = { id: 1 };
      const textual = { id: '1' };
      expect(resolveItemKey(numeric, numeric, selector).storageKey).not.toBe(
        resolveItemKey(textual, textual, selector).storageKey,
      );
    },
  );

  it('preserves numeric/string endpoints and embedded separators for implicit edge keys', () => {
    const records = [
      { source: 1, target: 2 },
      { source: '1', target: '2' },
      { source: 'a|target:b', target: 'c' },
      { source: 'a', target: 'b|target:c' },
    ];
    expect(new Set(records.map((record) => resolveItemKey(record, record).storageKey)).size).toBe(
      4,
    );
  });

  it('keeps environment and layer ID boundaries unambiguous', () => {
    expect(getLayerKey('a:b', 'c')).not.toBe(getLayerKey('a', 'b:c'));
  });
});
