import { ContainerView, AnyView } from "@/types/ui";
import { getEffectiveViewBox } from "./geometry";

export type ViewParentEntry = {
  parent: ContainerView;
  index: number;
  view: AnyView;
};

export const findView = (
  root: ContainerView,
  viewId: string,
  type?: AnyView['type'],
): AnyView | undefined => {
  if (root.id === viewId && (!type || root.type === type)) {
    return root;
  }

  for (const view of root.views) {
    if (view.id === viewId && (!type || view.type === type)) {
      return view;
    }
    if (view.type === 'container') {
      const found = findView(view as ContainerView, viewId);
      if (found) {
        return found;
      }
    }
  }

  return undefined;
};

export const findViewAndParentEntry = (
  root: ContainerView,
  viewId: string,
): ViewParentEntry | undefined => {
  const index = root.views.findIndex((view) => view.id === viewId);
  if (index !== -1) {
    return { parent: root, index, view: root.views[index] };
  }

  for (const view of root.views) {
    if (view.type === 'container') {
      const found = findViewAndParentEntry(view as ContainerView, viewId);
      if (found) {
        return found;
      }
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

  const visit = (view: AnyView, path: string) => {
    if (!view.id) {
      errors.push(`View at ${path} is missing an id`);
    } else if (seenIds.has(view.id)) {
      errors.push(`Duplicate view id "${view.id}" at ${path}`);
    } else {
      seenIds.add(view.id);
    }

    if (activeObjects.has(view)) {
      errors.push(`Cycle detected at ${path}`);
      return;
    }

    if (seenObjects.has(view)) {
      errors.push(`View object "${view.id}" is attached more than once`);
      return;
    }

    seenObjects.add(view);

    if (view.type !== 'container') {
      return;
    }

    activeObjects.add(view);
    view.views.forEach((child, index) => {
      visit(child, `${path}.views[${index}]`);
    });
    activeObjects.delete(view);
  };

  visit(root, 'root');
  return errors;
};

export const assertValidViewTree = (
  root: ContainerView,
  operation = 'view mutation',
): void => {
  const errors = validateViewTree(root);
  if (errors.length > 0) {
    throw new Error(`${operation} produced an invalid view tree: ${errors.join('; ')}`);
  }
};


export const getViewSizeByChildren = (
  container: ContainerView,
  padding = 32,
  min = 128,
) => {
  const children = container.views || [];
  const maxHeight = children.reduce(
    (acc, child) => {
      const box = getEffectiveViewBox(child);
      return acc > (box.top + box.height)
        ? acc : (box.top + box.height);
    },
    0);
  const maxWidth = children.reduce(
    (acc, child) => {
      const box = getEffectiveViewBox(child);
      return acc > (box.left + box.width)
        ? acc : (box.left + box.width);
    },
    0);

  return {
    height: Math.max(maxHeight + padding, min),
    width: Math.max(maxWidth + padding, min),
  };
};

export const getAllViews = (root: ContainerView): AnyView[] => {
  const views: AnyView[] = [root];
  root.views.forEach((view) => {
    views.push(view);
    if (view.type === 'container') {
      views.push(...getAllViews(view as ContainerView).slice(1)); // Skip the container itself
    }
  });
  return views;
};
