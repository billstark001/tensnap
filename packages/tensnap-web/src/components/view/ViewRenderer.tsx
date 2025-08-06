import { useState, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragMoveEvent,
} from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import { findAlignmentPoints, findSnapPosition } from './utils';
import * as styles from './styles.css';
import { ContainerView, AnyView } from '@/types/ui';
import { AlignmentGuides } from './AlignmentGuides';
import { DraggableView } from './DraggableView';
import { DroppableContainer } from './DroppableContainer';
import { useViewOperations } from './useViewOperations';

interface ViewRendererProps {
  initialView?: ContainerView;
}

export default function ViewRenderer({ initialView }: ViewRendererProps) {
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
  const [dragDelta, setDragDelta] = useState({ x: 0, y: 0 });

  const { findAndUpdateView, findAndDeleteView, findAndAddView, getAllViews } = useViewOperations();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor)
  );

  const handleUpdate = useCallback((viewId: string, updates: Partial<AnyView>) => {
    setRootView((prev) => findAndUpdateView(prev, viewId, updates));
  }, [findAndUpdateView]);

  const handleDelete = useCallback((viewId: string) => {
    setRootView((prev) => findAndDeleteView(prev, viewId));
  }, [findAndDeleteView]);

  const handleAddView = useCallback((parentId: string, newView: AnyView) => {
    setRootView((prev) => findAndAddView(prev, parentId, newView));
  }, [findAndAddView]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    const view = event.active.data.current?.view;
    if (view) {
      setDraggedView(view);
    }
  };

  const handleDragMove = (event: DragMoveEvent) => {
    if (!draggedView) return;
    
    const allViews = getAllViews(rootView);
    const guides = findAlignmentPoints(allViews, draggedView.id);
    const snapped = findSnapPosition(
      {
        x: draggedView.left + event.delta.x,
        y: draggedView.top + event.delta.y,
        width: draggedView.width,
        height: draggedView.height,
      },
      guides
    );
    
    setDragDelta({ x: snapped.x - draggedView.left, y: snapped.y - draggedView.top });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (!over || !active.data.current?.view) {
      setActiveId(null);
      setDraggedView(null);
      setDragDelta({ x: 0, y: 0 });
      return;
    }

    const draggedView = active.data.current.view;
    const sourceParentId = active.data.current.parentId;
    const targetContainerId = over.data.current?.containerId;

    const allViews = getAllViews(rootView);
    const guides = findAlignmentPoints(allViews, draggedView.id);
    const snapped = findSnapPosition(
      {
        x: draggedView.left + (event.delta.x || 0),
        y: draggedView.top + (event.delta.y || 0),
        width: draggedView.width,
        height: draggedView.height,
      },
      guides
    );

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
          left: Math.max(0, snapped.x),
          top: Math.max(0, snapped.y),
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
            left: Math.max(0, snapped.x),
            top: Math.max(0, snapped.y),
          }]
        };
      });
    } else {
      // Just update position with snapping
      handleUpdate(draggedView.id, {
        left: Math.max(0, snapped.x),
        top: Math.max(0, snapped.y),
      });
    }

    setActiveId(null);
    setDraggedView(null);
    setDragDelta({ x: 0, y: 0 });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      modifiers={[restrictToWindowEdges]}
    >
      <div className={styles.container}>
        <div className={styles.canvas} style={{ width: rootView.width, height: rootView.height }}>
          <DroppableContainer
            view={rootView}
            onUpdate={handleUpdate}
            onDelete={handleDelete}
            onAddView={handleAddView}
            onToggleExpand={(e) => {
              e.stopPropagation();
              handleUpdate(rootView.id, { expanded: !rootView.expanded });
            }}
          />
          {activeId && <AlignmentGuides guides={findAlignmentPoints(getAllViews(rootView), activeId)} active={{}} />}
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
              onUpdate={() => {}}
              onDelete={() => {}}
              onAddView={() => {}}
              siblings={[]}
              isOverlay
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}