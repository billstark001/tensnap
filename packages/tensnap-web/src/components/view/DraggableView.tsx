import React, { useCallback } from 'react';
import { useDraggable } from '@dnd-kit/core';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { Move, Edit, Trash2 } from 'lucide-react';
import { AnyView, ButtonView, AnchoredView, ContainerView } from '@/types/ui';
import { ResizeHandles } from './ResizeHandles';
import { ContainerViewComponent } from './ContainerViewComponent';
import * as styles from './styles.css';
import { ButtonViewComponent } from './ButtonViewComponent';
import { AnchoredViewComponent } from './AnchoredViewComponent';
import { ViewProps } from './common';
import { findAndDeleteView } from './utils/container';
import clsx from 'clsx';

interface DraggableViewProps extends ViewProps<AnyView> {
  relativeLeft?: number,
  relativeTop?: number,
  parentId?: string;
  siblings: AnyView[];
  isOverlay?: boolean;
  isUnderRootView?: boolean;
  onResizeStart?: (
    view: AnyView,
    parentView: ContainerView,
    direction: string,
    relativeLeft: number,
    relativeTop: number,
    clientX: number,
    clientY: number,
  ) => void;
}

export const DraggableView: React.FC<DraggableViewProps> = ({
  view,
  parentView,
  updateTrigger,
  onViewUpdate,
  relativeLeft = 0,
  relativeTop = 0,
  siblings,
  isOverlay = false,
  onResizeStart: _onResizeStart,
}) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: view.id,
    data: { view, siblings, relativeLeft, relativeTop, parentView: parentView, parentId: parentView?.id },
    disabled: isOverlay,
  });

  const style: React.CSSProperties = {
    left: `${view.left}px`,
    top: `${view.top}px`,
    width: `${view.width}px`,
    height: view.expanded ? `${view.height}px` : 'min-content',
  };

  const handleResizeStart = useCallback((direction: string, e: React.MouseEvent) => {
    if (!parentView || !_onResizeStart) return;
    _onResizeStart(
      view,
      parentView,
      direction,
      relativeLeft,
      relativeTop,
      e.clientX,
      e.clientY,
    );
  }, [view, parentView, relativeLeft, relativeTop, _onResizeStart]);

  const handleDelete = useCallback((id: string) => {
    if (!parentView) return;
    findAndDeleteView(parentView, id);
    onViewUpdate?.(parentView.id, parentView);
  }, [parentView, onViewUpdate]);

  const renderViewContent = () => {

    switch (view.type) {
      case 'button':
        return <ButtonViewComponent view={view as ButtonView} />;

      case 'container':
        const containerView = view as ContainerView;
        return (
          <ContainerViewComponent
            view={containerView}
            parentView={view}
            updateTrigger={updateTrigger}
            onViewUpdate={onViewUpdate}
            relativeLeft={relativeLeft}
            relativeTop={relativeTop}
            isOverlay={isOverlay || isDragging}
          />
        );

      case 'environment':
      case 'parameter':
      case 'chart':
        return <AnchoredViewComponent view={view as AnchoredView} />;

      default:
        return null;
    }
  };

  const body = (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(styles.draggableView, isDragging && !isOverlay && styles.draggingView)}
    >
      <div
        {...listeners}
        {...attributes}
        className={styles.dragHandle}
      >
        <Move className={styles.dragIcon} />
      </div>
      {renderViewContent()}
      {!isDragging && !isOverlay && <ResizeHandles onResizeStart={handleResizeStart} />}
    </div>
  );

  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          {body}
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
              onSelect={() => handleDelete(view.id)}
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