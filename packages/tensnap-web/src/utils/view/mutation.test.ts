import { describe, expect, it, vi } from 'vitest';
import type { AnyView, ContainerView } from '@/types/ui';
import { MAIN_VIEW_PADDING, viewConstants } from '@/components/view/constants';
import { createDefaultRootLayout } from './create-view';
import { validateViewTree } from './container';
import {
  addViewToContainerInPlace,
  moveViewInPlace,
  toggleViewExpandedInPlace,
  updateViewInPlace,
} from './mutation';

const createContainer = (
  id: string,
  views: AnyView[] = [],
  overrides: Partial<ContainerView> = {},
): ContainerView => ({
  id,
  type: 'container',
  left: 10,
  top: 20,
  width: 200,
  height: 300,
  expanded: true,
  disabled: false,
  data: { title: id },
  views,
  ...overrides,
});

const createButton = (id: string): AnyView => ({
  id,
  type: 'button',
  left: 0,
  top: 0,
  width: 120,
  height: 40,
  expanded: true,
  disabled: false,
  data: { id, text: id },
});

describe('view mutation utilities', () => {
  it('updates in place and invalidates through the mutation entrypoint', () => {
    const child = createButton('button-1');
    const root = createDefaultRootLayout([child]);
    const onViewUpdate = vi.fn();

    updateViewInPlace(
      { rootView: root, onViewUpdate, adjustRootPadding: false },
      child,
      { left: 24, top: 36 } as Partial<AnyView>,
    );

    expect(child.left).toBe(24);
    expect(child.top).toBe(36);
    expect(onViewUpdate).toHaveBeenCalledOnce();
    expect(onViewUpdate).toHaveBeenCalledWith(child);
  });

  it('rejects duplicate ids before adding a view', () => {
    const root = createDefaultRootLayout([createButton('duplicate')]);
    const onViewUpdate = vi.fn();

    expect(() => addViewToContainerInPlace(
      { rootView: root, onViewUpdate },
      root.id,
      createButton('duplicate'),
    )).toThrow('duplicate');

    expect(root.views).toHaveLength(1);
    expect(onViewUpdate).not.toHaveBeenCalled();
  });

  it('prevents moving a container into itself or a descendant', () => {
    const child = createContainer('child-container');
    const parent = createContainer('parent-container', [child]);
    const root = createDefaultRootLayout([parent]);

    expect(() => moveViewInPlace({
      rootView: root,
      view: parent,
      left: 40,
      top: 50,
      sourceParentId: root.id,
      targetContainerId: child.id,
    })).toThrow('Cannot move container');

    expect(root.views[0]).toBe(parent);
    expect(parent.views[0]).toBe(child);
    expect(validateViewTree(root)).toEqual([]);
  });

  it('uses effective collapsed height when toggling without mutating stored height', () => {
    const container = createContainer('collapsible');
    const root = createDefaultRootLayout([container]);
    const onViewUpdate = vi.fn();

    toggleViewExpandedInPlace({ rootView: root, onViewUpdate }, container);

    expect(container.expanded).toBe(false);
    expect(container.height).toBe(300);
    expect(root.height).toBe(Math.ceil(container.top + viewConstants.windowHeaderHeight + MAIN_VIEW_PADDING));
    expect(onViewUpdate).toHaveBeenCalledWith(root);
  });
});
