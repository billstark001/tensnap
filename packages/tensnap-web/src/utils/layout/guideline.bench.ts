import { test } from 'vitest';
import { GuideLineGenerator, type ViewBox } from './guideline';

for (const count of [100, 1_000, 10_000]) {
  test(`cached layout edge matching: ${count} siblings`, async ({ bench }) => {
    const views: ViewBox[] = Array.from({ length: count }, (_, index) => ({
      left: index * 150,
      top: index * 150,
      width: 100,
      height: 100,
    }));
    const coord: ViewBox = { left: 0, top: 0, width: 100, height: 100 };
    const generator = new GuideLineGenerator(5, { enableSpacing: false, enableSize: false });
    generator.generate({ coord, views }, true);
    await bench(`${count} sibling views`, () => {
      generator.generate({ coord, views }, false);
    }).run({ time: 500 });
  });
}
