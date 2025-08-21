import React, { useCallback, useRef } from 'react';
import { useDraggable } from '@dnd-kit/core';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { Move, Edit, Trash2 } from 'lucide-react';
import { AnyView, ButtonView, AnchoredView, ContainerView } from '@/types/ui';
import { ResizeHandles } from './ResizeHandles';
import { ContainerViewComponent } from './ContainerViewComponent';
import * as styles from './styles.css';
import { ButtonViewComponent } from './ButtonViewComponent';
import { AnchoredViewComponent } from './AnchoredViewComponent';

interface DraggableViewProps {
  view: AnyView;
  relativeLeft?: number,
  relativeTop?: number,
  parentId?: string;
  onUpdate: (viewId: string, updates: Partial<AnyView>) => void;
  onDelete: (viewId: string) => void;
  onAddView: (parentId: string, newView: AnyView) => void;
  siblings: AnyView[];
  isOverlay?: boolean;
}

export const DraggableView: React.FC<DraggableViewProps> = ({
  view,
  relativeLeft = 0,
  relativeTop = 0,
  parentId,
  onUpdate,
  onDelete,
  onAddView,
  siblings,
  isOverlay = false,
}) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: view.id,
    data: { view, siblings, relativeLeft, relativeTop, parentId },
    disabled: isOverlay,
  });

  const style: React.CSSProperties = {
    left: `${view.left}px`,
    top: `${view.top}px`,
    width: `${view.width}px`,
    height: view.expanded ? `${view.height}px` : 'min-content',
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
  };

  const viewSizeOnResizeStart = useRef<{ w: number, h: number}>();

  const handleResizeStart = useCallback(() => {
    viewSizeOnResizeStart.current = {
      w: view.width,
      h: view.height,
    };
  }, [view]);

  const handleResize = useCallback((deltaWidth: number, deltaHeight: number) => {
    const {
      w = 10,
      h = 10
    } = viewSizeOnResizeStart.current ?? {};

    const newWidth = Math.max(50, w + deltaWidth);
    const newHeight = Math.max(50, h + deltaHeight);

    onUpdate(view.id, {
      width: newWidth,
      height: newHeight,
    });
    
  }, [view, onUpdate, viewSizeOnResizeStart]);

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    onUpdate(view.id, { expanded: !view.expanded });
  };

  const renderViewContent = () => {
    


    switch (view.type) {
      case 'button':
        return <ButtonViewComponent view={view as ButtonView} />;

      case 'environment':
      case 'parameter':
      case 'chart':
        return <AnchoredViewComponent view={view as AnchoredView} />;

      case 'container':
        const containerView = view as ContainerView;
        return (
          <ContainerViewComponent
            view={containerView}
            relativeLeft={relativeLeft}
            relativeTop={relativeTop}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onAddView={onAddView}
            onToggleExpand={handleToggleExpand}
            isOverlay={isOverlay || isDragging}
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
            <div
              {...listeners}
              {...attributes}
              className={styles.dragHandle}
            >
              <Move className={styles.dragIcon} />
            </div>
            {renderViewContent()}
            {!isDragging && !isOverlay && <ResizeHandles 
              onResizeStart={handleResizeStart}
              onResize={handleResize} 
              onResizeEnd={handleResize}
            />}
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
    </>
  );
};