import type { AnyView, ContainerView } from '@/types/ui';
import { adjustForMainViewPadding } from './pack';
import {
  assertValidViewTree,
  findViewAndParentEntry,
  findView,
  isDescendantView,
} from './container';

export type ViewInvalidator = (view: AnyView, updatedView?: AnyView) => void;

export interface ViewMutationOptions {
  rootView: ContainerView;
  onViewUpdate?: ViewInvalidator;
  adjustRootPadding?: boolean;
  validate?: boolean;
  notifyView?: AnyView;
}

export interface ViewMoveOptions extends ViewMutationOptions {
  view: AnyView;
  left: number;
  top: number;
  sourceParentId?: string;
  targetContainerId?: string;
}

const notifyMutation = (
  options: ViewMutationOptions,
  fallbackView: AnyView,
) => {
  options.onViewUpdate?.(options.notifyView ?? fallbackView);
};

export function commitViewMutation<T>(
  options: ViewMutationOptions,
  mutate: () => T,
): T {
  const {
    rootView,
    adjustRootPadding = true,
    validate = false,
  } = options;
  const result = mutate();

  if (adjustRootPadding) {
    adjustForMainViewPadding(rootView);
  }

  if (validate) {
    assertValidViewTree(rootView);
  }

  notifyMutation(options, rootView);
  return result;
}

export function updateViewInPlace(
  options: ViewMutationOptions,
  view: AnyView,
  updates: Partial<AnyView>,
): void {
  commitViewMutation(
    { ...options, notifyView: options.notifyView ?? view },
    () => {
      Object.assign(view, updates);
    },
  );
}

export function toggleViewExpandedInPlace(
  options: ViewMutationOptions,
  view: ContainerView,
): void {
  commitViewMutation(options, () => {
    view.expanded = !view.expanded;
  });
}

export function addViewToContainerInPlace(
  options: ViewMutationOptions,
  parentId: string,
  newView: AnyView,
): boolean {
  if (findView(options.rootView, newView.id)) {
    throw new Error(`Cannot add duplicate view id "${newView.id}"`);
  }

  return commitViewMutation(options, () => {
    const parentView = findView(options.rootView, parentId, 'container');
    if (!parentView) {
      throw new Error(`Cannot find parent container "${parentId}"`);
    }
    (parentView as ContainerView).views.push(newView);
    return true;
  });
}

export function deleteViewInPlace(
  options: ViewMutationOptions,
  viewId: string,
): AnyView | undefined {
  if (viewId === options.rootView.id) {
    throw new Error('Cannot delete the root view');
  }

  const ctx = findViewAndParentEntry(options.rootView, viewId);
  if (!ctx) {
    throw new Error(`Cannot find view "${viewId}"`);
  }
  const { view, parent, index } = ctx;
  const deletedView = view ? structuredClone(view) : undefined;

  commitViewMutation(options, () => {
    parent.views.splice(index, 1);
  });

  return deletedView;
}

export function moveViewInPlace(options: ViewMoveOptions): void {
  const {
    rootView,
    view,
    left,
    top,
    sourceParentId,
    targetContainerId,
  } = options;

  if (view.id === rootView.id) {
    throw new Error('Cannot move the root view');
  }

  if (targetContainerId && view.type === 'container' && isDescendantView(rootView, view.id, targetContainerId)) {
    throw new Error(`Cannot move container "${view.id}" into itself or one of its descendants`);
  }

  const sourceEntry = findViewAndParentEntry(rootView, view.id);
  if (!sourceEntry) {
    throw new Error(`Cannot find view "${view.id}" in the view tree`);
  }

  const targetContainer = targetContainerId
    ? findView(rootView, targetContainerId)
    : undefined;

  if (targetContainerId && targetContainer?.type !== 'container') {
    throw new Error(`Cannot find target container "${targetContainerId}"`);
  }

  commitViewMutation(
    { ...options, notifyView: rootView },
    () => {
      Object.assign(view, { left, top });

      if (targetContainerId && sourceParentId !== targetContainerId) {
        sourceEntry.parent.views.splice(sourceEntry.index, 1);
        (targetContainer as ContainerView).views.push(view);
        return;
      }

      if (!targetContainerId && sourceParentId) {
        sourceEntry.parent.views.splice(sourceEntry.index, 1);
        rootView.views.push(view);
        return;
      }

    },
  );
}
