import { test } from 'vitest';
import type { CollisionDetection, DroppableContainer } from '@dnd-kit/core';
import { nestedOverlapCollisionDetection } from './collision';

for (const count of [100, 1000]) {
  test(`overlapping layout containers: ${count}`, async ({ bench }) => {
    const rect = { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };
    const root = document.createElement('div');
    const containers: DroppableContainer[] = Array.from({ length: count }, (_, index) => {
      const node = document.createElement('div');
      root.append(node);
      return {
        id: index,
        key: String(index),
        disabled: false,
        node: { current: node },
        rect: { current: null },
        data: { current: {} },
      };
    });
    const args: Parameters<CollisionDetection>[0] = {
      active: {
        id: 'active',
        data: { current: {} },
        rect: { current: { initial: null, translated: null } },
      },
      collisionRect: rect,
      droppableContainers: containers,
      droppableRects: new Map(containers.map(({ id }) => [id, rect])),
      pointerCoordinates: null,
    };
    await bench('detect', () => nestedOverlapCollisionDetection(args)).run({ time: 500 });
  });
}
