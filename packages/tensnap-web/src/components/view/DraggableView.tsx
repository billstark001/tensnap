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
}) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: view.id,
    data: { view, siblings, relativeLeft, relativeTop, parentId: parentView?.id },
    disabled: isOverlay,
  });

  const style: React.CSSProperties = {
    left: `${view.left}px`,
    top: `${view.top}px`,
    width: `${view.width}px`,
    height: view.expanded ? `${view.height}px` : 'min-content',
  };

  const viewSizeOnResizeStart = useRef<{ w: number, h: number }>(undefined);

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

    // 批量更新，避免频繁触发重渲染
    if (Math.abs(view.width - newWidth) > 1 || Math.abs(view.height - newHeight) > 1) {
      view.width = newWidth;
      view.height = newHeight;
      onViewUpdate?.(view.id, view);
    }
  }, [view, onViewUpdate, viewSizeOnResizeStart]);

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
      {!isDragging && !isOverlay && <ResizeHandles
        onResizeStart={handleResizeStart}
        onResize={handleResize}
        onResizeEnd={handleResize}
      />}
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