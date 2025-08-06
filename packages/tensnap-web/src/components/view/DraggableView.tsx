import React, { useState, useCallback, useEffect } from 'react';
import { useDraggable } from '@dnd-kit/core';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { Move, Edit, Trash2 } from 'lucide-react';
import { AnyView, ButtonView, AnchoredView, ContainerView } from '@/types/ui';
import { findAlignmentPoints, findSnapPosition, snapToGrid } from './utils';
import { ResizeHandles } from './ResizeHandles';
import { AlignmentGuides } from './AlignmentGuides';
import { DroppableContainer } from './DroppableContainer';
import * as styles from './styles.css';

interface DraggableViewProps {
  view: AnyView;
  parentId?: string;
  onUpdate: (viewId: string, updates: Partial<AnyView>) => void;
  onDelete: (viewId: string) => void;
  onAddView: (parentId: string, newView: AnyView) => void;
  siblings: AnyView[];
  isOverlay?: boolean;
  onDragMove?: (delta: { x: number; y: number }) => void;
}

export const DraggableView: React.FC<DraggableViewProps> = ({
  view,
  parentId,
  onUpdate,
  onDelete,
  onAddView,
  siblings,
  isOverlay = false,
  onDragMove
}) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: view.id,
    data: { view, parentId },
    disabled: isOverlay,
  });

  const [activeGuides, setActiveGuides] = useState<{ vertical?: number; horizontal?: number }>({});

  const style: React.CSSProperties = {
    left: `${view.left}px`,
    top: `${view.top}px`,
    width: `${view.width}px`,
    height: `${view.height}px`,
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
  };

  useEffect(() => {
    if (isDragging && transform && onDragMove) {
      const guides = findAlignmentPoints(siblings, view.id);
      const snapped = findSnapPosition(
        {
          x: view.left + transform.x,
          y: view.top + transform.y,
          width: view.width,
          height: view.height,
        },
        guides
      );
      setActiveGuides(snapped.snappedGuides);
      onDragMove({ x: snapped.x - view.left, y: snapped.y - view.top });
    } else {
      setActiveGuides({});
    }
  }, [transform, isDragging, view, siblings, onDragMove]);

  const handleResize = useCallback((deltaWidth: number, deltaHeight: number) => {
    const newWidth = Math.max(50, view.width + deltaWidth);
    const newHeight = Math.max(50, view.height + deltaHeight);
    
    // Snap size to grid
    onUpdate(view.id, {
      width: snapToGrid(newWidth),
      height: snapToGrid(newHeight),
    });
  }, [view, onUpdate]);

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    onUpdate(view.id, { expanded: !view.expanded });
  };

  const renderViewContent = () => {
    switch (view.type) {
      case 'button':
        return (
          <div className={styles.buttonView}>
            {(view as ButtonView).data.text}
          </div>
        );
      
      case 'environment':
      case 'parameter':
      case 'chart':
        return (
          <div className={styles.anchoredView}>
            <div className={styles.anchoredViewHeader}>
              <span style={{ fontWeight: 500, fontSize: '14px' }}>
                {(view as AnchoredView).data.title || view.type}
              </span>
            </div>
            <div className={styles.anchoredViewContent}>
              <p style={{ color: '#6b7280', fontSize: '14px' }}>
                ID: {(view as AnchoredView).data.id}
              </p>
            </div>
          </div>
        );
      
      case 'container':
        const containerView = view as ContainerView;
        return (
          <DroppableContainer
            view={containerView}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onAddView={onAddView}
            onToggleExpand={handleToggleExpand}
          />
        );
      
      default:
        return null;
    }
  };

  const className = `${styles.draggableView} ${isDragging && !isOverlay ? styles.draggingView : ''}`;

  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <div
            ref={setNodeRef}
            style={style}
            className={className}
          >
            {view.type !== 'container' && (
              <div
                {...listeners}
                {...attributes}
                className={styles.dragHandle}
              >
                <Move className={styles.dragIcon} />
              </div>
            )}
            {renderViewContent()}
            {!isDragging && !isOverlay && <ResizeHandles onResize={handleResize} />}
          </div>
        </ContextMenu.Trigger>
        
        <ContextMenu.Portal>
          <ContextMenu.Content className={styles.contextMenu}>
            <ContextMenu.Item
              className={styles.contextMenuItem}
              onSelect={() => console.log('Edit', view.id)}
            >
              <Edit style={{ width: '16px', height: '16px', marginRight: '8px' }} />
              编辑
            </ContextMenu.Item>
            <ContextMenu.Item
              className={styles.contextMenuItemDanger}
              onSelect={() => onDelete(view.id)}
            >
              <Trash2 style={{ width: '16px', height: '16px', marginRight: '8px' }} />
              删除
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {isDragging && <AlignmentGuides guides={findAlignmentPoints(siblings, view.id)} active={activeGuides} />}
    </>
  );
};