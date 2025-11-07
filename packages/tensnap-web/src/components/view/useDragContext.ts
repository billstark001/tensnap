import { useCallback, useMemo, useRef, useState } from 'react';
import {
  DragEndEvent,
  DragStartEvent,
  DragMoveEvent,
} from '@dnd-kit/core';
import { ContainerView, AnyView } from '@/types/ui';
import { ViewContextScheme } from './useViewContext';
import { throttle } from '@/utils/react';
import { findAndAddView, findAndDeleteView } from './utils/container';
import { ViewProps } from './common';
import { Coordinates } from '@dnd-kit/core/dist/types';
import { GuideLine, GuideLineMatcher, ViewBox } from '@/utils/layout/guideline';

export type ViewRendererProps = ViewProps<ContainerView> &
  Partial<Pick<ViewContextScheme, 'onButtonAction' | 'renderAnchoredView'>>;

type DragContent = {
  id: string;
  view: AnyView;
  mouseX: number;
  mouseY: number;
};

type DragState = {
  content: DragContent | null;
  container: ContainerView | null;
  guideOrigin: { relativeLeft: number; relativeTop: number };
  guideLines: GuideLine[];
  suggestedSnap: ViewBox | null;
};

const SNAP_THRESHOLD = 10;
const INITIAL_GUIDE_ORIGIN = { relativeLeft: 0, relativeTop: 0 };

const getCalibratedCoordinates = (
  view: ViewBox,
  source: { relativeLeft?: number; relativeTop?: number },
  target: { relativeLeft?: number; relativeTop?: number },
  delta: Coordinates,
  clipZero = true,
): ViewBox => {
  const { left = 0, top = 0, width, height } = view;
  const { relativeLeft: sourceLeft = 0, relativeTop: sourceTop = 0 } = source;
  const { relativeLeft: targetLeft = 0, relativeTop: targetTop = 0 } = target;
  const { x: deltaX = 0, y: deltaY = 0 } = delta;

  const ret: ViewBox = {
    left: (left + sourceLeft - targetLeft + deltaX) | 0,
    top: (top + sourceTop - targetTop + deltaY) | 0,
    width,
    height,
  };

  if (clipZero) {
    ret.left = Math.max(0, ret.left);
    ret.top = Math.max(0, ret.top);
  }
  return ret;
};

// 提取拖拽指南线逻辑
export function useDragGuidelines() {
  const matcherRef = useRef<GuideLineMatcher | null>(null);

  const initMatcher = useCallback((coord: ViewBox, views: AnyView[]) => {
    matcherRef.current = new GuideLineMatcher({ coord, views }, SNAP_THRESHOLD);
  }, []);

  const updateViews = useCallback((views: AnyView[]) => {
    matcherRef.current?.updateViews(views);
  }, []);

  const match = useCallback((coord: ViewBox) => {
    const result = matcherRef.current?.match(coord);
    if (!result) return { guidelines: [], snap: null };

    const { guidelines = [], snapX, snapY } = result;
    const snap = (snapX != null || snapY != null) ? {
      ...coord,
      left: snapX ?? coord.left,
      top: snapY ?? coord.top,
    } : null;

    return { guidelines, snap };
  }, []);

  const clear = useCallback(() => {
    matcherRef.current = null;
  }, []);

  return { initMatcher, updateViews, match, clear };
}

// 提取拖拽状态管理
export function useDragState() {
  const [state, setState] = useState<DragState>({
    content: null,
    container: null,
    guideOrigin: INITIAL_GUIDE_ORIGIN,
    guideLines: [],
    suggestedSnap: null,
  });

  const updateState = useCallback((partial: Partial<DragState>) => {
    setState(prev => ({ ...prev, ...partial }));
  }, []);

  const clearState = useCallback(() => {
    setState({
      content: null,
      container: null,
      guideOrigin: INITIAL_GUIDE_ORIGIN,
      guideLines: [],
      suggestedSnap: null,
    });
  }, []);

  return { state, updateState, clearState };
}

export function useDragContent({
  rootView,
  onViewUpdate,
}: {
  rootView: ContainerView;
  onViewUpdate?: (id: string, view: AnyView) => void;
}) {
  const dragState = useDragState();
  const dragGuidelines = useDragGuidelines();
  const { state, updateState, clearState } = dragState;
  const { initMatcher, updateViews, match, clear: clearMatcher } = dragGuidelines;

  const updateSnapState = useCallback((coord: ViewBox) => {
    const { guidelines, snap } = match(coord);
    updateState({ guideLines: guidelines, suggestedSnap: snap });
    return snap;
  }, [match, updateState]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { offsetX = 0, offsetY = 0 } = event.activatorEvent as PointerEvent;
    const { view, parentView, relativeLeft, relativeTop } = event.active.data.current ?? {};
    const id = event.active.id as string;

    if (!view || !id) return;

    const mouseX = offsetX / window.devicePixelRatio;
    const mouseY = offsetY / window.devicePixelRatio;
    const coord = { left: view.left, top: view.top, width: view.width, height: view.height };

    initMatcher(coord, parentView.views ?? []);

    updateState({
      content: { id, view, mouseX, mouseY },
      container: parentView,
      guideOrigin: { relativeLeft, relativeTop },
    });

    updateSnapState(coord);
  }, [initMatcher, updateState, updateSnapState]);

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const { view: activeView } = event.active.data.current ?? {};
    const { view: overView, relativeLeft, relativeTop } = event.over?.data.current ?? {};

    const coord = getCalibratedCoordinates(
      activeView,
      event.active.data.current as any,
      event.over?.data.current as any,
      event.delta,
    );

    if (overView.id !== state.container?.id) {
      updateViews((overView as ContainerView).views ?? []);
      updateState({
        container: overView as ContainerView,
        guideOrigin: { relativeLeft, relativeTop },
      });
    }

    updateSnapState(coord);
  }, [state.container, updateViews, updateState, updateSnapState]);

  const throttledHandleDragMove = useMemo(
    () => throttle(handleDragMove, 32),
    [handleDragMove]
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || !active.data.current?.view) {
      clearState();
      clearMatcher();
      return;
    }

    const { view: draggedView, parentId: sourceParentId } = active.data.current;
    const { containerId: targetContainerId } = over.data.current ?? {};

    const coords = getCalibratedCoordinates(
      draggedView,
      active.data.current as any,
      over.data.current as any,
      event.delta,
      true,
    );

    const snappedCoords = updateSnapState(coords) || coords;
    Object.assign(draggedView, snappedCoords);

    // 处理视图移动逻辑
    if (targetContainerId && sourceParentId !== targetContainerId) {
      const [container, index] = findAndDeleteView(rootView, draggedView.id, !!sourceParentId) ?? [];
      const success = findAndAddView(rootView, targetContainerId, draggedView);

      if (!success && container && index !== undefined) {
        container.views.splice(index, 0, draggedView);
      }
      onViewUpdate?.(rootView.id, rootView);
    } else if (!targetContainerId && sourceParentId) {
      findAndDeleteView(rootView, draggedView.id, true);
      rootView.views.push(draggedView);
      onViewUpdate?.(rootView.id, rootView);
    } else {
      onViewUpdate?.(draggedView.id, draggedView);
    }

    clearState();
    clearMatcher();
  }, [rootView, clearState, clearMatcher, onViewUpdate, updateSnapState]);

  return {
    dragState,
    dragGuidelines,
    onDragStart: handleDragStart,
    onDragMove: throttledHandleDragMove,
    onDragEnd: handleDragEnd,
  };

};