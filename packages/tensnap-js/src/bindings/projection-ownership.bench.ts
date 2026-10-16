import { test } from 'vitest';
import { build } from 'esbuild';
import type * as Fields from './fields';
import type * as Utils from './utils';
import type { ItemRecord } from './types';

// Bundle the measured functions once so native execution has the same static
// internal calls as production, without Vitest's per-export getter tracking.
const bundle = await build({
  stdin: {
    contents:
      "export { projectFields } from './fields'; export { cloneItem, diffItem, resolveItemKey } from './utils';",
    resolveDir: import.meta.dirname,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const {
  projectFields,
  cloneItem: copyItem,
  diffItem: compareItem,
  resolveItemKey,
} = (await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`
)) as Pick<typeof Fields, 'projectFields'> &
  Pick<typeof Utils, 'cloneItem' | 'diffItem' | 'resolveItemKey'>;

const phase = process.env.TENSNAP_BENCH_PHASE ?? 'diff';
if (phase !== 'diff' && phase !== 'sync')
  throw new Error('TENSNAP_BENCH_PHASE must be diff or sync');
const count = Number(process.env.TENSNAP_BENCH_ITEMS ?? 1000);
if (!Number.isSafeInteger(count) || count < 1)
  throw new Error('TENSNAP_BENCH_ITEMS must be a positive integer');
for (const nested of [false, true]) {
  for (const changed of [false, true]) {
    for (const mode of ['builtin', 'boundary', 'custom', 'owned', 'double'] as const) {
      test(`${phase} ${count} ${nested ? 'nested' : 'scalar'} ${changed ? 'changed' : 'unchanged'} ${mode}`, async ({
        bench,
      }) => {
        const items = Array.from({ length: count }, (_, id) => ({
          id,
          x: id,
          ...(nested ? { data: { count: id, tags: ['ready'] } } : {}),
        }));
        const builtin = projectFields<undefined, (typeof items)[number]>(
          {
            id: 'id',
            x: 'x',
            ...(nested ? { data: 'data' } : {}),
          },
          mode !== 'boundary',
        );
        const previous: ItemRecord[] = items.map((item) => copyItem(item));
        const keys = items.map((item) => resolveItemKey(item, item));
        await bench('project, publish, retain', () => {
          if (changed)
            for (let i = 0; i < Math.max(1, count / 100); i++) {
              items[i]!.x++;
              if (nested) items[i]!.data!.count++;
            }
          for (let i = 0; i < count; i++) {
            const raw =
              mode === 'custom'
                ? items[i]!
                : mode === 'owned'
                  ? copyItem(items[i]!)
                  : builtin(undefined, items[i]!);
            const current = copyItem(
              raw,
              phase === 'sync' ? undefined : previous[i],
              mode === 'custom' || mode === 'double' || mode === 'boundary',
            );
            if (phase === 'diff') compareItem(previous[i]!, current, keys[i]!);
            previous[i] = current;
          }
        }).run({ time: 300 });
      });
    }
  }
}
