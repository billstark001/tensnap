import { useCallback, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Move } from 'lucide-react';
import { AnyView, ButtonView, AnchoredView, ContainerView } from '@/types/ui';
import { ResizeHandles } from './ResizeHandles';
import { ContainerViewComponent } from './ContainerViewComponent';
import * as styles from './styles.css';
import { ButtonViewComponent } from './ButtonViewComponent';
import { AnchoredViewComponent } from './AnchoredViewComponent';
import { DraggableViewData, getViewType, ViewProps } from './types';
import clsx from 'clsx';
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
  const { ViewContextMenuRenderer, isAdjusting, onResizeStart } = useViewContext();

  const [node, setNode] = useState<HTMLElement | null>(null);

  const data: DraggableViewData = { view, siblings, relativeLeft, relativeTop, parentView, parentId: parentView?.id };

  const { attributes, listeners, setNodeRef: _setNodeRef, isDragging } = useDraggable({
    id: view.id,
    data,
    disabled: isOverlay,
  });

  const setNodeRef = useCallback((node: HTMLElement | null) => {
    _setNodeRef(node);
    setNode(node);
  }, [_setNodeRef]);

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

  const renderViewContent = () => {

    switch (view.type) {
      case 'button':
        return <ButtonViewComponent view={view as ButtonView} />;

      case 'container': {
        const containerView = view as ContainerView;
        return (
          <ContainerViewComponent
            view={containerView}
            parentView={parentView}
            updateTrigger={updateTrigger}
            relativeLeft={relativeLeft}
            relativeTop={relativeTop}
            isOverlay={isOverlay || isDragging}
          />
        );
      }

      case 'environment':
      case 'parameter':
      case 'chart':
        return <AnchoredViewComponent view={view as AnchoredView} parentView={parentView} />;

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

  const { type, dataType } = getViewType(view);

  return (
    <ViewContextMenuRenderer
      node={node}
      view={view}
      parentView={parentView}
      type={type}
      dataType={dataType}
    >
      {body}
    </ViewContextMenuRenderer>
  );

};