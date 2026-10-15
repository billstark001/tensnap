import { describe, expect, it } from 'vitest';
import type { AnyView, ContainerView } from '@/types/ui';
import { findView, findViewAndParentEntry, getAllViews, validateViewTree } from './container';

function container(id: string, views: AnyView[] = []): ContainerView {
  return {
    id,
    type: 'container',
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    expanded: true,
    disabled: false,
    data: { title: id },
    views,
  };
}

describe('view tree traversal', () => {
  it('preserves a requested type while searching nested containers', () => {
    const button: AnyView = {
      ...container('target'),
      type: 'button',
      data: { id: 'step', text: 'Step' },
    };
    const root = container('root', [container('nested', [button])]);
    expect(findView(root, 'target')).toBe(button);
    expect(findView(root, 'target', 'container')).toBeUndefined();
  });

  it('walks a deeply nested tree in preorder without recursive array copying', () => {
    let root = container('leaf');
    for (let index = 0; index < 15_000; index++) root = container(`node-${index}`, [root]);
    const views = getAllViews(root);
    expect(views).toHaveLength(15_001);
    expect(views[0]).toBe(root);
    expect(views[views.length - 1]?.id).toBe('leaf');
    expect(findView(root, 'leaf')?.id).toBe('leaf');
    expect(findViewAndParentEntry(root, 'leaf')?.parent.id).toBe('node-0');
    expect(validateViewTree(root)).toEqual([]);
  });

  it('terminates on repeated or cyclic objects', () => {
    const child = container('child');
    const root = container('root', [child, child]);
    child.views.push(root);
    expect(getAllViews(root)).toEqual([root, child]);
    expect(findView(root, 'missing')).toBeUndefined();
    expect(findViewAndParentEntry(root, 'missing')).toBeUndefined();
    expect(validateViewTree(root)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Cycle detected'),
        expect.stringContaining('attached more than once'),
      ]),
    );
  });
});
