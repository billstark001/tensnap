import { ContainerView, AnyView } from "@/types/ui";


export const findAndUpdateView = (
  root: ContainerView,
  viewId: string,
  updates: Partial<AnyView>,
  recursive = true,
): boolean => {
  if (root.id === viewId) {
    Object.assign(root, updates);
    return true;
  }

  for (const view of root.views) {
    if (view.id === viewId) {
      Object.assign(view, updates);
      return true;
    }
    if (!recursive) {
      continue;
    }
    if (view.type === 'container') {
      if (findAndUpdateView(view as ContainerView, viewId, updates)) {
        return true;
      }
    }
  }

  return false;
};

export const findAndDeleteView = (
  root: ContainerView,
  viewId: string,
  recursive = true,
): boolean => {
  const index = root.views.findIndex(view => view.id === viewId);

  if (index !== -1) {
    root.views.splice(index, 1);
    return true;
  }

  if (!recursive) {
    return false;
  }

  for (const view of root.views) {
    if (view.type === 'container') {
      if (findAndDeleteView(view as ContainerView, viewId)) {
        return true;
      }
    }
  }

  return false;
};

export const findAndAddView = (
  root: ContainerView,
  parentId: string,
  newView: AnyView,
  recursive = true,
): boolean => {
  if (root.id === parentId) {
    root.views.push(newView);
    return true;
  }

  if (!recursive) {
    return false;
  }

  for (const view of root.views) {
    if (view.type === 'container') {
      if (findAndAddView(view as ContainerView, parentId, newView)) {
        return true;
      }
    }
  }

  return false;
};

export const findAndGetUpdatedView = (
  root: ContainerView,
  viewId: string,
  updates: Partial<AnyView>,
): ContainerView => {
  if (root.id === viewId) {
    return { ...root, ...updates } as ContainerView;
  }

  return {
    ...root,
    views: root.views.map((view) => {
      if (view.id === viewId) {
        return { ...view, ...updates };
      }
      if (view.type === 'container') {
        return findAndGetUpdatedView(view as ContainerView, viewId, updates);
      }
      return view;
    }) as any,
  };
};

export const findAndGetDeletedView = (
  root: ContainerView,
  viewId: string,
): ContainerView => {
  return {
    ...root,
    views: root.views
      .filter((view) => view.id !== viewId)
      .map((view) => {
        if (view.type === 'container') {
          return findAndGetDeletedView(view as ContainerView, viewId);
        }
        return view;
      }),
  };
};

export const findAndGetAddedView = (
  root: ContainerView,
  parentId: string,
  newView: AnyView,
): ContainerView => {
  if (root.id === parentId) {
    return {
      ...root,
      views: [...root.views, newView],
    };
  }

  return {
    ...root,
    views: root.views.map((view) => {
      if (view.type === 'container') {
        return findAndGetAddedView(view as ContainerView, parentId, newView);
      }
      return view;
    }),
  };
};


export const getViewSizeByChildren = (
  container: ContainerView,
  padding = 32,
  min = 128,
) => {
  const children = container.views || [];
  const maxHeight = children.reduce(
    (acc, child) => acc > (child.top + child.height)
      ? acc : (child.top + child.height),
    0);
  const maxWidth = children.reduce(
    (acc, child) => acc > (child.left + child.width)
      ? acc : (child.left + child.width),
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