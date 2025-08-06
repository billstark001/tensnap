import { useCallback, useState } from 'react';
import { ContainerView, AnyView, AlignmentGuides } from '@/types/ui';
import { ViewContextScheme } from './useViewContext';

export const useViewOperations = () => {

  const [guides, setGuides] = useState<AlignmentGuides>({
    vertical: [], horizontal: []
  });

  const findAndUpdateView = useCallback((
    root: ContainerView,
    viewId: string,
    updates: Partial<AnyView>
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
          return findAndUpdateView(view as ContainerView, viewId, updates);
        }
        return view;
      }) as any,
    };
  }, []);

  const findAndDeleteView = useCallback((
    root: ContainerView,
    viewId: string
  ): ContainerView => {
    return {
      ...root,
      views: root.views
        .filter((view) => view.id !== viewId)
        .map((view) => {
          if (view.type === 'container') {
            return findAndDeleteView(view as ContainerView, viewId);
          }
          return view;
        }),
    };
  }, []);

  const findAndAddView = useCallback((
    root: ContainerView,
    parentId: string,
    newView: AnyView
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
          return findAndAddView(view as ContainerView, parentId, newView);
        }
        return view;
      }),
    };
  }, []);

  const getAllViews = useCallback((root: ContainerView): AnyView[] => {
    const views: AnyView[] = [root];
    root.views.forEach((view) => {
      views.push(view);
      if (view.type === 'container') {
        views.push(...getAllViews(view as ContainerView).slice(1)); // Skip the container itself
      }
    });
    return views;
  }, []);

  const getViewContext = (): Pick<ViewContextScheme, 'guides' | 'setGuides'> => ({
    guides,
    setGuides,
  });

  return {
    getViewContext,
    findAndUpdateView,
    findAndDeleteView,
    findAndAddView,
    getAllViews,
  };
};