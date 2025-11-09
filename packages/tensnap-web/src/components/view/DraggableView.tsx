import React, { useCallback, useState } from 'react';
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
import { findAndDeleteView, findAndUpdateView } from './utils/container';
import clsx from 'clsx';
import { Trans } from '@lingui/react/macro';
import { EditViewDialog } from '../../dialogs/EditViewDialog';
import { useViewContext } from './useViewContext';

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
  relativeLeft = 0,
  relativeTop = 0,
  siblings,
  isOverlay = false,
}) => {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const { isAdjusting, onResizeStart, onViewUpdate } = useViewContext();

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
    if (!parentView || !onResizeStart) return;
    onResizeStart(
      view,
      parentView,
      direction,
      relativeLeft,
      relativeTop,
      e.clientX,
      e.clientY,
    );
  }, [view, parentView, relativeLeft, relativeTop, onResizeStart]);

  const handleDelete = useCallback((id: string) => {
    if (!parentView) return;
    findAndDeleteView(parentView, id);
    onViewUpdate?.(parentView.id, parentView);
  }, [parentView, onViewUpdate]);

  const handleEdit = useCallback(() => {
    setIsEditDialogOpen(true);
  }, []);

  const handleSaveEdit = useCallback((updatedView: AnyView) => {
    const updateRoot = parentView ?? (view.type === 'container' ? view as ContainerView : null);
    if (!updateRoot) {
      return;
    }
    const { id: viewId, type: _, ...rest } = updatedView;
    delete (rest as any).views; 
    findAndUpdateView(updateRoot, viewId, rest);
    onViewUpdate?.(updateRoot.id, updateRoot);
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
      {isAdjusting && <div
        {...listeners}
        {...attributes}
        className={styles.dragHandle}
      >
        <Move className={styles.dragIcon} />
      </div>}
      {renderViewContent()}
      {isAdjusting && !isDragging && !isOverlay && <ResizeHandles onResizeStart={handleResizeStart} horizontalOnly={
        view.type === 'container' && !view.expanded
      } />}
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
              onSelect={handleEdit}
            >
              <Edit style={{ width: '16px', height: '16px', marginRight: '8px' }} />
              <Trans>Edit</Trans>
            </ContextMenu.Item>
            <ContextMenu.Item
              className={styles.contextMenuItemDanger}
              onSelect={() => handleDelete(view.id)}
            >
              <Trash2 style={{ width: '16px', height: '16px', marginRight: '8px' }} />
              <Trans>Delete</Trans>
            </ContextMenu.Item>
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      <EditViewDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        view={view}
        onSave={handleSaveEdit}
      />
    </>
  );
};