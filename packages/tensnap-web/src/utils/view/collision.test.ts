import { describe, expect, it } from 'vitest';
import type { ClientRect, CollisionDetection, DroppableContainer } from '@dnd-kit/core';
import { createNestedCollisionDetection, nestedOverlapCollisionDetection } from './collision';

const box = (left = 0, top = 0, width = 100, height = 100): ClientRect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
});

function container(
  id: string,
  node = document.createElement('div'),
  disabled = false,
): DroppableContainer {
  return {
    id,
    key: id,
    disabled,
    node: { current: node },
    rect: { current: null },
    data: { current: {} },
  };
}

function args(
  containers: DroppableContainer[],
  collisionRect = box(),
): Parameters<CollisionDetection>[0] {
  return {
    active: {
      id: 'active',
      data: { current: {} },
      rect: { current: { initial: null, translated: null } },
    },
    collisionRect,
    droppableContainers: containers,
    droppableRects: new Map(containers.map(({ id }) => [id, box()])),
    pointerCoordinates: null,
  };
}

describe('nested layout collision detection', () => {
  it('prefers nested containers and keeps independent sibling candidates', () => {
    const parent = document.createElement('div');
    const child = document.createElement('div');
    const nested = document.createElement('div');
    parent.append(child);
    child.append(nested);
    const input = args([
      container('parent', parent),
      container('child', child),
      container('nested', nested),
      container('sibling'),
    ]);
    expect(nestedOverlapCollisionDetection(input).map(({ id }) => id)).toEqual([
      'nested',
      'sibling',
    ]);
  });

  it('counts registrations sharing a node without making them ancestors of each other', () => {
    const parent = document.createElement('div');
    const child = document.createElement('div');
    parent.append(child);
    const input = args([container('child', child), container('a', parent), container('b', parent)]);
    expect(nestedOverlapCollisionDetection(input).map(({ id }) => id)).toEqual(['child']);
  });

  it.each([
    [0, 0],
    [0, 10],
    [10, 0],
    [10, 10],
  ])('handles %s by %s dragged rectangles at inclusive boundaries', (width, height) => {
    const input = args([container('inside')], box(100, 100, width, height));
    expect(nestedOverlapCollisionDetection(input).map(({ id }) => id)).toEqual(['inside']);
    input.collisionRect = box(101, 101, width, height);
    expect(nestedOverlapCollisionDetection(input)).toEqual([]);
  });

  it('excludes disabled and active containers in pointer fallback', () => {
    const input = args(
      [container('active'), container('disabled', undefined, true), container('valid')],
      box(1000, 1000, 0, 0),
    );
    input.pointerCoordinates = { x: 20, y: 20 };
    const detect = createNestedCollisionDetection({ usePointerPosition: true });
    expect(detect(input).map(({ id }) => id)).toEqual(['valid']);
  });
});
