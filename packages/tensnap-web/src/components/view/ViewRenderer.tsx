import { useCallback, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragMoveEvent,
} from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import * as styles from './styles.css';
import { ContainerView, AnyView } from '@/types/ui';
import { ContainerViewComponent } from './ContainerViewComponent';
import { nestedOverlapCollisionDetection } from './collision';
import { ViewContext, ViewContextScheme } from './useViewContext';
import { throttle, useCallbackRef } from '@/utils/react';
import { findAndAddView, findAndDeleteView } from './utils/container';
import { ViewProps } from './common';
import { viewConstants } from './constants';
import { Coordinates } from '@dnd-kit/core/dist/types';
import { GuideLine, GuideLineMatcher, ViewBox } from '@/utils/layout/guideline';
import { Guidelines } from './GuideLines';

export type ViewRendererProps = ViewProps<ContainerView> & {
} & Partial<Pick<ViewContextScheme, 'onButtonAction' | 'renderAnchoredView'>>;

type DragContent = {
  id: string;
  view: AnyView;
  mouseX: number;
  mouseY: number;
};

type RelativeLeftTopObject = {
  relativeLeft: number;
  relativeTop: number;
};

const getCalibratedCoordinates = (
  view: ViewBox,
  source: RelativeLeftTopObject,
  target: RelativeLeftTopObject,
  delta: Coordinates,
  clipZero = true,
): ViewBox => {

  const { left: viewLeft = 0, top: viewTop = 0, width, height } = view ?? {};
  const { relativeLeft: sourceLeft = 0, relativeTop: sourceTop = 0 } = source ?? {};
  const { relativeLeft: targetLeft = 0, relativeTop: targetTop = 0 } = target ?? {};
  const { x: deltaX = 0, y: deltaY = 0 } = delta ?? {};

  const ret: ViewBox = {
    left: (viewLeft + sourceLeft - targetLeft + deltaX) | 0,
    top: (viewTop + sourceTop - targetTop + deltaY) | 0,
    width,
    height,
  };
  if (clipZero) {
    ret.left = Math.max(0, ret.left);
    ret.top = Math.max(0, ret.top);
  }
  return ret;
};

const SNAP_THRESHOLD = 10;

export default function ViewRenderer({
  view: rootView,
  updateTrigger,
  onViewUpdate: _onViewUpdate,
  onButtonAction: _onButtonAction,
  renderAnchoredView: _renderAnchoredView,
}: ViewRendererProps) {

  const [dragContent, setDragContent] = useState<DragContent | null>(null);
  const currentDragContainerRef = useRef<ContainerView | null>(null);
  const guidelineMatcherRef = useRef<GuideLineMatcher | null>(null);
  const [guideOrigin, setGuideOrigin] = useState<RelativeLeftTopObject>({ relativeLeft: 0, relativeTop: 0 });
  const [guideLines, setGuideLines] = useState<GuideLine[]>([]);

  const clearDragContent = useCallback(() => {
    setDragContent(null);
    currentDragContainerRef.current = null;
    guidelineMatcherRef.current = null;
    setGuideLines([]);
    setGuideOrigin({ relativeLeft: 0, relativeTop: 0 });
  }, []);

  const onViewUpdate = useCallbackRef(_onViewUpdate ?? (() => void 0));


  const onButtonAction = useCallbackRef(_onButtonAction ?? (() => void 0));
  const renderAnchoredView = useCallbackRef(_renderAnchoredView ?? (() => undefined));

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const { offsetX = 0, offsetY = 0 } = event.activatorEvent as PointerEvent;
    const mouseX = offsetX / window.devicePixelRatio;
    const mouseY = offsetY / window.devicePixelRatio;
    const { view, parentView, relativeLeft, relativeTop } = event.active.data.current ?? {};
    const id = event.active.id as string;
    if (!view || !id) {
      return;
    }
    setDragContent({
      id,
      view,
      mouseX,
      mouseY,
    });
    const coord = { left: view.left, top: view.top, width: view.width, height: view.height };
    const views = parentView.views ?? [];
    guidelineMatcherRef.current = new GuideLineMatcher({
      coord,
      views
    }, SNAP_THRESHOLD);
    currentDragContainerRef.current = parentView;
    const { guidelines = [] } = guidelineMatcherRef.current.match(coord);
    setGuideLines(guidelines);
    setGuideOrigin({ relativeLeft, relativeTop });

  }, [setDragContent]);

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const { view: activeView } = event.active.data.current ?? {};
    const { view: overView, relativeLeft, relativeTop } = event.over?.data.current ?? {};
    const coord = getCalibratedCoordinates(
      activeView,
      event.active.data.current as any,
      event.over?.data.current as any,
      event.delta,
    );
    // compare current views and update if changed
    if (overView.id !== currentDragContainerRef.current?.id) {
      currentDragContainerRef.current = overView as ContainerView;
      guidelineMatcherRef.current?.updateViews((overView as ContainerView).views ?? []);
      setGuideOrigin({ relativeLeft, relativeTop });
    }
    const { guidelines = [] } = guidelineMatcherRef.current?.match(coord) ?? {};
    setGuideLines(guidelines);
  }, []);

  const throttledHandleDragMove = useMemo(() => {
    return throttle(handleDragMove, 16);
  }, [handleDragMove]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || !active.data.current?.view) {
      clearDragContent();
      return;
    }

    const {
      view: draggedView,
      parentId: sourceParentId,
    } = active.data.current ?? {};

    const {
      containerId: targetContainerId,
    } = over.data.current ?? {};

    const coords = getCalibratedCoordinates(
      draggedView,
      active.data.current as any,
      over.data.current as any,
      event.delta,
      true,
    );
    Object.assign(draggedView, coords);

    if (targetContainerId && sourceParentId !== targetContainerId) {
      // Remove from source
      // If source is root, just filter it out
      const [container, index] = findAndDeleteView(rootView, draggedView.id, !!sourceParentId) ?? [];
      // Move view to new container
      const success = findAndAddView(rootView, targetContainerId, draggedView);
      if (!success && container && index !== undefined) {
        container.views.splice(index, 0, draggedView);
      }

      onViewUpdate(rootView.id, rootView);

    } else if (!targetContainerId && sourceParentId) {
      // Move view out of container to root
      findAndDeleteView(rootView, draggedView.id, true);
      // Add to root with snapped position
      rootView.views.push(draggedView);

      onViewUpdate(rootView.id, rootView);
    } else {
      // Just update position with snapping
      onViewUpdate(draggedView.id, draggedView);
    }

    clearDragContent();
  }, [rootView, clearDragContent]);

  return (
    <ViewContext.Provider value={{
      onButtonAction,
      renderAnchoredView,
    }}>
      <DndContext
        sensors={sensors}
        collisionDetection={nestedOverlapCollisionDetection}
        onDragStart={handleDragStart}
        onDragMove={throttledHandleDragMove}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToWindowEdges]}
      >
        <div className={styles.container}>
          <div className={styles.rootView} style={{ width: rootView.width, height: rootView.height }}>
            <ContainerViewComponent
              view={rootView}
              updateTrigger={updateTrigger}
              onViewUpdate={onViewUpdate}
              isRootView
            />
          </div>

          {guideLines.length > 0 && <Guidelines guidelines={guideLines} leftShift={guideOrigin.relativeLeft} topShift={guideOrigin.relativeTop} />}

        </div>
        <DragOverlay>
          {dragContent ? (
            <div className={styles.dragOverlayAnchor} style={{
              width: dragContent.mouseX + viewConstants.dragHandleContentDelta,
              height: dragContent.mouseY + viewConstants.dragHandleContentDelta,
            }}>
              <div className={styles.dragOverlay} style={{
                width: dragContent.view.width,
                height: dragContent.view.height,
              }} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </ViewContext.Provider>
  );
}