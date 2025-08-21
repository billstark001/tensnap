import { useState, useCallback } from 'react';
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
import { findAndAddView, findAndDeleteView, findAndUpdateView, getViewSizeByChildren } from './utils/container';
import { GuidePointSet } from './utils/snap-module';

export type ViewRendererProps = {
  initialView?: ContainerView;
} & Partial<Pick<ViewContextScheme, 'onButtonAction' | 'renderAnchoredView'>>;

export default function ViewRenderer({
  initialView,
  onButtonAction: _onButtonAction,
  renderAnchoredView: _renderAnchoredView,
}: ViewRendererProps) {
  const [rootView, setRootView] = useState<ContainerView>(initialView || {
    id: 'root',
    type: 'container',
    left: 0,
    top: 0,
    width: 800,
    height: 600,
    expanded: true,
    data: { title: 'Root Container' },
    views: [],
  });

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

  const handleUpdate = useCallback((viewId: string, updates: Partial<AnyView>) => {
    setRootView((prev) => {
      const cur = findAndUpdateView(prev, viewId, updates);
      Object.assign(cur, getViewSizeByChildren(cur, 64, 600));
      return cur;
    });
  }, []);

  const handleDelete = useCallback((viewId: string) => {
    setRootView((prev) => {
      const cur = findAndDeleteView(prev, viewId);
      Object.assign(cur, getViewSizeByChildren(cur, 64, 600));
      return cur;
    });
  }, []);

  const handleAddView = useCallback((parentId: string, newView: AnyView) => {
    setRootView((prev) => {
      const cur = findAndAddView(prev, parentId, newView);
      Object.assign(cur, getViewSizeByChildren(cur, 64, 600));
      return cur;
    });
  }, []);

  const handleDragStart = (event: DragStartEvent) => {
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
  };

  const handleDragEnd = (event: DragEndEvent) => {
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

    if (targetContainerId && sourceParentId !== targetContainerId) {
      // Move view to new container
      setRootView((prev) => {
        let updated = prev;
        // Remove from source
        if (sourceParentId) {
          updated = findAndDeleteView(updated, draggedView.id);
        } else {
          updated = {
            ...updated,
            views: updated.views.filter(v => v.id !== draggedView.id)
          };
        }
        // Add to target with snapped position
        updated = findAndAddView(updated, targetContainerId, {
          ...draggedView,
          left: Math.max(0, newState.x),
          top: Math.max(0, newState.y),
        });
        return updated;
      });
    } else if (!targetContainerId && sourceParentId) {
      // Move view out of container to root
      setRootView((prev) => {
        const updated = findAndDeleteView(prev, draggedView.id);
        return {
          ...updated,
          views: [...updated.views, {
            ...draggedView,
            left: Math.max(0, newState.x),
            top: Math.max(0, newState.y),
          }]
        };
      });
    } else {
      // Just update position with snapping
      handleUpdate(draggedView.id, {
        left: Math.max(0, newState.x),
        top: Math.max(0, newState.y),
      });
    }

    setGuides({
      horizontal: [],
      vertical: [],
    });
    setActiveId(null);
    setDraggedView(null);
  };

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
        // onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToWindowEdges]}
      >
        <div className={styles.container}>
          <div className={styles.canvas} style={{ width: rootView.width, height: rootView.height }}>
            <ContainerViewComponent
              view={rootView}
              isRootView
              onUpdate={handleUpdate}
              onDelete={handleDelete}
              onAddView={handleAddView}
              onToggleExpand={(e) => {
                e.stopPropagation();
                handleUpdate(rootView.id, { expanded: !rootView.expanded });
              }}
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
                onUpdate={() => { }}
                onDelete={() => { }}
                onAddView={() => { }}
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