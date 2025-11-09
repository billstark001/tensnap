import { useCallback, useRef, useState, useEffect } from 'react';
import {
  DragEndEvent,
  DragStartEvent,
  DragMoveEvent,
} from '@dnd-kit/core';
import { ContainerView, AnyView } from '@/types/ui';
import { ViewContextScheme } from './useViewContext';
import { useCallbackRef, useThrottled } from '@/utils/react';
import { findAndAddView, findAndDeleteView } from './utils/container';
import { ViewProps } from './common';
import { Coordinates } from '@dnd-kit/core/dist/types';
import { GuideLine, GuideLineMatcher, ViewBox } from '@/utils/layout/guideline';
import { SNAP_THRESHOLD } from './constants';
import { adjustForMainViewPadding } from './utils/pack';

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

type ResizeContent = {
  view: AnyView;
  direction: string;
  startWidth: number;
  startHeight: number;
};

type ResizeState = {
  content: ResizeContent | null;
  container: ContainerView | null;
  guideOrigin: { relativeLeft: number; relativeTop: number };
  guideLines: GuideLine[];
  suggestedSnap: ViewBox | null;
};

const INITIAL_GUIDE_ORIGIN = { relativeLeft: 0, relativeTop: 0 };

const getCalibratedCoordinates = (
  view: ViewBox,
  source: { relativeLeft?: number; relativeTop?: number },
  target: { relativeLeft?: number; relativeTop?: number },
  delta: Coordinates,
  clipZero = true,
): ViewBox => {
  const { left = 0, top = 0, width, height } = view ?? {};
  const { relativeLeft: sourceLeft = 0, relativeTop: sourceTop = 0 } = source ?? {};
  const { relativeLeft: targetLeft = 0, relativeTop: targetTop = 0 } = target ?? {};
  const { x: deltaX = 0, y: deltaY = 0 } = delta ?? {};

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
export function useDragGuidelines(mode: 'drag' | 'resize' = 'drag') {
  const matcherRef = useRef<GuideLineMatcher | null>(null);

  const initMatcher = useCallback((coord: ViewBox, views: AnyView[]) => {
    matcherRef.current = new GuideLineMatcher({ coord, views }, SNAP_THRESHOLD, mode, {
      enableSize: true,
      enableSpacing: true,
    });
  }, [mode]);

  const updateViews = useCallback((views: AnyView[]) => {
    matcherRef.current?.updateViews(views);
  }, []);

  const match = useCallback((coord: ViewBox) => {
    const result = matcherRef.current?.match(coord);
    if (!result) return { guidelines: [], snap: null };

    const { guidelines = [], snapX, snapY } = result;

    if (mode === 'resize') {
      // Resize 模式：snapX 和 snapY 是 width 和 height
      const snap = (snapX != null || snapY != null) ? {
        ...coord,
        width: snapX ?? coord.width,
        height: snapY ?? coord.height,
      } : null;
      return { guidelines, snap };
    } else {
      // Drag 模式：snapX 和 snapY 是 left 和 top
      const snap = (snapX != null || snapY != null) ? {
        ...coord,
        left: snapX ?? coord.left,
        top: snapY ?? coord.top,
      } : null;
      return { guidelines, snap };
    }
  }, [mode]);

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

// 提取 resize 状态管理
export function useResizeState() {
  const [state, setState] = useState<ResizeState>({
    content: null,
    container: null,
    guideOrigin: INITIAL_GUIDE_ORIGIN,
    guideLines: [],
    suggestedSnap: null,
  });

  const updateState = useCallback((partial: Partial<ResizeState>) => {
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
    if (!event.over) {
      return;
    }
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

  const throttledHandleDragMove = useThrottled(handleDragMove, 32);

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

    adjustForMainViewPadding(rootView);

    clearState();
    clearMatcher();
  }, [rootView, clearState, clearMatcher, onViewUpdate, updateSnapState]);

  // cleanup
  useEffect(() => {
    return () => {
      throttledHandleDragMove.cancel();
    };
  }, []);

  return {
    dragState,
    dragGuidelines,
    onDragStart: handleDragStart,
    onDragMove: throttledHandleDragMove,
    onDragEnd: handleDragEnd,
  };

};

// Resize 功能
export function useResizeContent({
  rootView,
  onViewUpdate,
}: {
  rootView: ContainerView;
  onViewUpdate?: (id: string, view: AnyView) => void;
}) {
  const resizeState = useResizeState();
  const resizeGuidelines = useDragGuidelines('resize');
  const { state, updateState, clearState } = resizeState;
  const { initMatcher, match, clear: clearMatcher } = resizeGuidelines;

  const isResizing = useRef<string | undefined>(undefined);
  const startPos = useRef<{ x: number; y: number } | undefined>(undefined);
  const rafId = useRef<number | undefined>(undefined);
  const lastUpdateTime = useRef<number>(0);

  const onResizeStart = useCallbackRef((
    view: AnyView,
    parentView: ContainerView,
    direction: string,
    relativeLeft: number,
    relativeTop: number,
    clientX: number,
    clientY: number,
  ) => {
    isResizing.current = direction;
    startPos.current = { x: clientX, y: clientY };

    const coord = { left: view.left, top: view.top, width: view.width, height: view.height };
    initMatcher(coord, parentView.views ?? []);

    updateState({
      content: {
        view,
        direction,
        startWidth: view.width,
        startHeight: view.height,
      },
      container: parentView,
      guideOrigin: { relativeLeft, relativeTop },
    });

    const { guidelines, snap } = match(coord);
    updateState({ guideLines: guidelines, suggestedSnap: snap });
  });

  const onResize = useCallbackRef((clientX: number, clientY: number) => {
    if (!startPos.current || !isResizing.current || !state.content) {
      return;
    }

    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
    }

    rafId.current = requestAnimationFrame(() => {
      const currentTime = Date.now();
      if (currentTime - lastUpdateTime.current < 16) return;

      lastUpdateTime.current = currentTime;

      if (!startPos.current || !isResizing.current || !state.content) return;

      const { x: lastX, y: lastY } = startPos.current;
      const { view, direction, startWidth, startHeight } = state.content;

      const deltaX = clientX - lastX;
      const deltaY = clientY - lastY;

      let newWidth = startWidth;
      let newHeight = startHeight;

      switch (direction) {
        case 'se':
          newWidth = Math.max(60, startWidth + deltaX | 0);
          newHeight = Math.max(view.type === 'button' ? 30 : 60, startHeight + deltaY | 0);
          break;
        case 'e':
          newWidth = Math.max(60, startWidth + deltaX | 0);
          break;
        case 's':
          newHeight = Math.max(view.type === 'button' ? 30 : 60, startHeight + deltaY | 0);
          break;
      }

      const coord = {
        left: view.left,
        top: view.top,
        width: newWidth,
        height: newHeight,
      };

      const { guidelines, snap } = match(coord);

      // snap 中的 width 和 height 已经被调整好了
      if (snap) {
        view.width = snap.width;
        view.height = snap.height;
      } else {
        view.width = newWidth;
        view.height = newHeight;
      }

      updateState({ guideLines: guidelines, suggestedSnap: snap });
      onViewUpdate?.(view.id, view);
    });
  });

  const onResizeEnd = useCallbackRef((clientX: number, clientY: number) => {
    if (!startPos.current || !isResizing.current || !state.content) {
      return;
    }

    if (rafId.current) {
      cancelAnimationFrame(rafId.current);
      rafId.current = undefined;
    }

    const { x: lastX, y: lastY } = startPos.current;
    const { view, direction, startWidth, startHeight } = state.content;

    const deltaX = clientX - lastX;
    const deltaY = clientY - lastY;

    let newWidth = startWidth;
    let newHeight = startHeight;

    switch (direction) {
      case 'se':
        newWidth = Math.max(60, startWidth + deltaX | 0);
        newHeight = Math.max(view.type === 'button' ? 30 : 60, startHeight + deltaY | 0);
        break;
      case 'e':
        newWidth = Math.max(60, startWidth + deltaX | 0);
        break;
      case 's':
        newHeight = Math.max(view.type === 'button' ? 30 : 60, startHeight + deltaY | 0);
        break;
    }

    const coord = {
      left: view.left,
      top: view.top,
      width: newWidth,
      height: newHeight,
    };

    const { snap } = match(coord);

    if (snap) {
      view.width = snap.width;
      view.height = snap.height;
    } else {
      view.width = newWidth;
      view.height = newHeight;
    }

    onViewUpdate?.(view.id, view);
    adjustForMainViewPadding(rootView);

    isResizing.current = undefined;
    startPos.current = undefined;
    clearState();
    clearMatcher();
  });

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing.current) return;
    onResize(e.clientX, e.clientY);
  }, [onResize]);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    if (!isResizing.current) return;
    onResizeEnd(e.clientX, e.clientY);
  }, [onResizeEnd]);

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove, { passive: true });
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      if (rafId.current) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, [handleMouseMove, handleMouseUp]);

  return {
    resizeState,
    resizeGuidelines,
    onResizeStart,
  };
}
