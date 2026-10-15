import { test } from 'vitest';
import { projectFields } from './fields';

test('compiled field selectors: 1000 agents', async ({ bench }) => {
  const project = projectFields<
    {},
    { id: number; pos: { x: number; y: number }; values: number[] }
  >({
    id: 'id',
    x: 'pos.x',
    y: 'pos.y',
    size: 'values[0]',
  });
  const items = Array.from({ length: 1000 }, (_, id) => ({
    id,
    pos: { x: id, y: id },
    values: [1],
  }));
  const model = {};
  await bench('project', () => {
    for (const item of items) project(model, item);
  }).run({ time: 500 });
});
