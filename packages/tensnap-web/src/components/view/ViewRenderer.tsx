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
import { DraggableView } from './DraggableView';
import { ContainerViewComponent } from './ContainerViewComponent';
import { nestedOverlapCollisionDetection } from './collision';
import { ViewContext, ViewContextScheme } from './useViewContext';
import { useCallbackRef } from '@/utils/react';
import { findAndAddView, findAndDeleteView } from './utils/container';
import { GuidePointSet } from '@/utils/layout/snap';
import { ViewProps } from './common';

export type ViewRendererProps = ViewProps<ContainerView> & {
} & Partial<Pick<ViewContextScheme, 'onButtonAction' | 'renderAnchoredView'>>;

export default function ViewRenderer({
  view: rootView,
  updateTrigger,
  onViewUpdate: _onViewUpdate,
  onButtonAction: _onButtonAction,
  renderAnchoredView: _renderAnchoredView,
}: ViewRendererProps) {

  const onViewUpdate = useCallbackRef(_onViewUpdate ?? (() => void 0));

  const [activeId, setActiveId] = useState<string | null>(null);
  const [draggedView, setDraggedView] = useState<AnyView | null>(null);
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
    setActiveId(event.active.id as string);
    // const {
    //   view: draggedView,
    //   siblings: draggedSiblings,
    // } = event.active.data.current ?? {};
    // const guides = findAlignmentGuides(draggedSiblings, draggedView.id);
    // vc.setGuides(guides);
    const view = event.active.data.current?.view;
    if (view) {
      setDraggedView(view);
    }
  }, [setActiveId, setDraggedView]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || !active.data.current?.view) {
      setGuides({
        horizontal: [],
        vertical: [],
      });
      setActiveId(null);
      setDraggedView(null);
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
      findAndDeleteView(rootView, draggedView.id, !!sourceParentId);
      
      // Add to target with snapped position
      draggedView.left = Math.max(0, newState.x);
      draggedView.top = Math.max(0, newState.y);
      findAndAddView(rootView, targetContainerId, draggedView);

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
    setActiveId(null);
    setDraggedView(null);
  }, [setGuides, setActiveId, setDraggedView]);

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
          {activeId && draggedView ? (
            <div className={styles.dragOverlay}>
              <DraggableView
                view={{
                  ...draggedView,
                  left: 0,
                  top: 0,
                }}
                siblings={[]}
                isOverlay
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </ViewContext.Provider>
  );
}