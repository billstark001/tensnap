import { ContainerView, AnyView } from '@/types/ui';
import { getEffectiveViewBox } from './geometry';

export type ViewParentEntry = {
  parent: ContainerView;
  index: number;
  view: AnyView;
};

/**
 * Walk each view object once in depth-first declaration order, including root.
 * Iteration avoids call-stack limits and terminates on malformed cyclic trees.
 * This model traversal has no dependency on React or the drag/drop host.
 */
export function* iterateViews(root: AnyView): Generator<AnyView> {
  const pending: AnyView[] = [root];
  const visited = new WeakSet<AnyView>();
  while (pending.length > 0) {
    const view = pending.pop()!;
    if (visited.has(view)) continue;
    visited.add(view);
    yield view;
    if (view.type === 'container') {
      for (let index = view.views.length - 1; index >= 0; index--) pending.push(view.views[index]!);
    }
  }
}

/** Find the first matching ID and optional type at any depth, including root. */
export const findView = (
  root: ContainerView,
  viewId: string,
  type?: AnyView['type'],
): AnyView | undefined => {
  for (const view of iterateViews(root)) {
    if (view.id === viewId && (!type || view.type === type)) {
      return view;
    }
  }

  return undefined;
};

export const findViewAndParentEntry = (
  root: ContainerView,
  viewId: string,
): ViewParentEntry | undefined => {
  for (const parent of iterateViews(root)) {
    if (parent.type !== 'container') continue;
    const index = parent.views.findIndex((view) => view.id === viewId);
    if (index !== -1) {
      return { parent, index, view: parent.views[index]! };
    }
  }

  return undefined;
};

export const isDescendantView = (
  root: ContainerView,
  ancestorId: string,
  descendantId: string,
): boolean => {
  const ancestor = findView(root, ancestorId);
  if (!ancestor || ancestor.type !== 'container') {
    return false;
  }

  return Boolean(findView(ancestor as ContainerView, descendantId));
};

export const validateViewTree = (root: ContainerView): string[] => {
  const errors: string[] = [];
  const seenIds = new Set<string>();
  const seenObjects = new WeakSet<AnyView>();
  const activeObjects = new WeakSet<AnyView>();

  type Visit = { view: AnyView; path: string; exit?: boolean };
  const pending: Visit[] = [{ view: root, path: 'root' }];
  while (pending.length > 0) {
    const { view, path, exit } = pending.pop()!;
    if (exit) {
      activeObjects.delete(view);
      continue;
    }
    if (!view.id) {
      errors.push(`View at ${path} is missing an id`);
    } else if (seenIds.has(view.id)) {
      errors.push(`Duplicate view id "${view.id}" at ${path}`);
    } else {
      seenIds.add(view.id);
    }

    if (activeObjects.has(view)) {
      errors.push(`Cycle detected at ${path}`);
      continue;
    }

    if (seenObjects.has(view)) {
      errors.push(`View object "${view.id}" is attached more than once`);
      continue;
    }

    seenObjects.add(view);

    if (view.type !== 'container') {
      continue;
    }

    activeObjects.add(view);
    pending.push({ view, path, exit: true });
    for (let index = view.views.length - 1; index >= 0; index--) {
      pending.push({ view: view.views[index]!, path: `${path}.views[${index}]` });
    }
  }
  return errors;
};

export const assertValidViewTree = (root: ContainerView, operation = 'view mutation'): void => {
  const errors = validateViewTree(root);
  if (errors.length > 0) {
    throw new Error(`${operation} produced an invalid view tree: ${errors.join('; ')}`);
  }
};

export const getViewSizeByChildren = (container: ContainerView, padding = 32, min = 128) => {
  const children = container.views || [];
  let maxHeight = 0;
  let maxWidth = 0;
  for (const child of children) {
    const box = getEffectiveViewBox(child);
    maxHeight = Math.max(maxHeight, box.top + box.height);
    maxWidth = Math.max(maxWidth, box.left + box.width);
  }

  return {
    height: Math.max(maxHeight + padding, min),
    width: Math.max(maxWidth + padding, min),
  };
};

export const getAllViews = (root: ContainerView): AnyView[] => {
  return Array.from(iterateViews(root));
};
