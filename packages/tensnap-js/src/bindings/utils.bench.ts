import { test } from 'vitest';
import { cloneItem, diffItem, resolveItemKey } from './utils';

for (const nested of [false, true]) {
  test(`snapshot and diff 1000 ${nested ? 'nested' : 'scalar'} agents`, async ({ bench }) => {
    const clone = cloneItem;
    const diff = diffItem;
    const items = Array.from({ length: 1_000 }, (_, id) => ({
      id,
      x: id,
      y: id,
      ...(nested ? { data: { count: id, tags: ['ready'] } } : {}),
    }));
    const previous = items.map((item) => clone(item));
    const keys = items.map((item) => resolveItemKey(item, item));
    await bench('unchanged snapshot and diff', () => {
      for (let index = 0; index < items.length; index++) {
        diff(previous[index]!, clone(items[index]!, previous[index]), keys[index]!);
      }
    }).run({ time: 500 });
  });
}
