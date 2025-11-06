import { useCallback, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
} from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import * as styles from './styles.css';
import { ContainerView, AnyView } from '@/types/ui';
import { ContainerViewComponent } from './ContainerViewComponent';
import { nestedOverlapCollisionDetection } from './collision';
import { ViewContext, ViewContextScheme } from './useViewContext';
import { useCallbackRef } from '@/utils/react';
import { findAndAddView, findAndDeleteView } from './utils/container';
import { GuidePointSet } from '@/utils/layout/snap';
import { ViewProps } from './common';
import { viewConstants } from './constants';

export type ViewRendererProps = ViewProps<ContainerView> & {
} & Partial<Pick<ViewContextScheme, 'onButtonAction' | 'renderAnchoredView'>>;

type DragContent = {
  id: string;
  view: AnyView;
  mouseX: number;
  mouseY: number;
}

export default function ViewRenderer({
  view: rootView,
  updateTrigger,
  onViewUpdate: _onViewUpdate,
  onButtonAction: _onButtonAction,
  renderAnchoredView: _renderAnchoredView,
}: ViewRendererProps) {

  const onViewUpdate = useCallbackRef(_onViewUpdate ?? (() => void 0));

  const [dragContent, setDragContent] = useState<DragContent | null>(null);

  const [guides, setGuides] = useState<GuidePointSet>({
    vertical: [], horizontal: []
  });

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
    // const {
    //   view: draggedView,
    //   siblings: draggedSiblings,
    // } = event.active.data.current ?? {};
    // const guides = findAlignmentGuides(draggedSiblings, draggedView.id);
    // vc.setGuides(guides);
    const { offsetX = 0, offsetY = 0 } = event.activatorEvent as PointerEvent;
    const mouseX = offsetX / window.devicePixelRatio;
    const mouseY = offsetY / window.devicePixelRatio;
    const view = event.active.data.current?.view;
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

  }, [setDragContent]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || !active.data.current?.view) {
      setGuides({
        horizontal: [],
        vertical: [],
      });
      setDragContent(null);
      return;
    }

    const {
      view: draggedView,
      parentId: sourceParentId,
      relativeLeft: sourceLeft,
      relativeTop: sourceTop,
    } = active.data.current ?? {};

    const {
      containerId: targetContainerId,
      relativeLeft: targetLeft,
      relativeTop: targetTop,
    } = over.data.current ?? {};

    const newState = {
      x: draggedView.left + sourceLeft - targetLeft + (event.delta.x || 0),
      y: draggedView.top + sourceTop - targetTop + (event.delta.y || 0),
      width: draggedView.width,
      height: draggedView.height,
    }

    // Update position with snapping
    draggedView.left = Math.max(0, newState.x);
    draggedView.top = Math.max(0, newState.y);

    if (targetContainerId && sourceParentId !== targetContainerId) {
      // Move view to new container
      // Remove from source
      // If source is root, just filter it out
      const [container, index] = findAndDeleteView(rootView, draggedView.id, !!sourceParentId) ?? [];

      // Add to target with snapped position
      draggedView.left = Math.max(0, newState.x);
      draggedView.top = Math.max(0, newState.y);
      const success = findAndAddView(rootView, targetContainerId, draggedView);
      if (!success && container && index !== undefined) {
        container.views.splice(index, 0, draggedView);
      }

      onViewUpdate(rootView.id, rootView);

    } else if (!targetContainerId && sourceParentId) {
      // Move view out of container to root
      findAndDeleteView(rootView, draggedView.id, true);

      // Add to root with snapped position
      draggedView.left = Math.max(0, newState.x);
      draggedView.top = Math.max(0, newState.y);
      rootView.views.push(draggedView);

      onViewUpdate(rootView.id, rootView);
    } else {
      // Just update position with snapping
      onViewUpdate(draggedView.id, draggedView);
    }

    setGuides({
      horizontal: [],
      vertical: [],
    });
    setDragContent(null);
  }, [rootView, setGuides, setDragContent]);

  return (
    <ViewContext.Provider value={{
      guides,
      setGuides,
      onButtonAction,
      renderAnchoredView,
    }}>
      <DndContext
        sensors={sensors}
        collisionDetection={nestedOverlapCollisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToWindowEdges]}
      >
        <div className={styles.container}>
          <div className={styles.canvas} style={{ width: rootView.width, height: rootView.height }}>
            <ContainerViewComponent
              view={rootView}
              updateTrigger={updateTrigger}
              onViewUpdate={onViewUpdate}
              isRootView
            />
            {/* {activeId && <AlignmentGuides guides={findAlignmentGuides(getAllViews(rootView), activeId)} active={{}} />} */}
          </div>
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