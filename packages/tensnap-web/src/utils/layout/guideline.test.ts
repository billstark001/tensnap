import { describe, expect, it } from 'vitest';
import { GuideLineGenerator, GuideLineMatcher, type ViewBox } from './guideline';

const box = (left: number, top: number, width = 100, height = 100): ViewBox => ({
  left,
  top,
  width,
  height,
});

describe('layout guidelines', () => {
  it('finds repeated sizes after a singleton group', () => {
    const generator = new GuideLineGenerator(5);
    const views = [box(0, 0, 20, 30), box(200, 200), box(400, 400)];
    const matcher = new GuideLineMatcher({ coord: box(50, 50), views }, 5, 'resize');
    expect(matcher.match(box(50, 50, 103, 102))).toMatchObject({ snapWidth: 100, snapHeight: 100 });
    expect(generator.generate({ coord: box(50, 50, 103, 102), views })).toEqual(
      expect.arrayContaining([expect.objectContaining({ alignType: 'size-v' })]),
    );
  });

  it('clears size and spacing state along with the edge index', () => {
    const generator = new GuideLineGenerator(5);
    const coord = box(220, 0);
    generator.generate({ coord, views: [box(0, 0), box(110, 0)] });
    generator.clearCache();
    expect(generator.generate({ coord, views: [] }, false)).toEqual([]);
    expect(generator.generate({ coord, views: [] })).toEqual([]);
  });

  it('keeps cached geometry stable until the caller invalidates it', () => {
    const generator = new GuideLineGenerator(5);
    const coord = box(0, 0);
    const views = [box(0, 0), box(110, 0)];
    const before = generator.generate({ coord, views });
    views[0]!.top = 500;
    views[0]!.width = 300;
    expect(generator.generate({ coord, views }, false)).toEqual(before);
    expect(generator.generate({ coord, views }, true)).not.toEqual(before);
  });
});
