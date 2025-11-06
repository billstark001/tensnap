import React, { useCallback } from 'react';
import { useDroppable } from '@dnd-kit/core';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { ChevronDown, ChevronRight, Square, Link, Container } from 'lucide-react';
import { ContainerView, AnyView, ButtonView, AnchoredView } from '@/types/ui';
import { generateUniqueId } from '@/utils/common';
import { DraggableView } from './DraggableView';
import * as styles from './styles.css';
import { viewConstants } from './constants';
import cx from 'clsx';
import { ViewProps } from './common';
import { findAndAddView } from './utils/container';

interface ContainerViewComponentProps extends ViewProps<ContainerView> {
  relativeLeft?: number,
  relativeTop?: number,
  isOverlay?: boolean;
  isRootView?: boolean;
}

export const ContainerViewComponent: React.FC<ContainerViewComponentProps> = ({
  view,
  updateTrigger,
  onViewUpdate,
  relativeLeft = 0,
  relativeTop = 0,
  isOverlay = false,
  isRootView = false,
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `container-${view.id}`,
    data: {
      containerId: view.id,
      relativeLeft: relativeLeft + view.left + (isRootView ? 0 : viewConstants.windowLeftDelta),
      relativeTop: relativeTop + view.top + (isRootView ? 0 : viewConstants.windowTopDelta),
    },
    disabled: isOverlay,
  });

  const handleCreateView = (type: 'action' | 'environment' | 'container', e: React.MouseEvent) => {
    e.stopPropagation();
    const containerRect = (e.currentTarget as HTMLElement).closest(`.${styles.windowViewContent}`)?.getBoundingClientRect();

    const relativeX = containerRect ? e.clientX / window.devicePixelRatio - containerRect.left : 50;
    const relativeY = containerRect ? e.clientY / window.devicePixelRatio - containerRect.top : 50;

    // Snap to grid
    const snappedX = Math.max(0, relativeX - 75);
    const snappedY = Math.max(0, relativeY - 50);

    let newView: AnyView;
    const baseProps = {
      id: generateUniqueId(),
      left: snappedX,
      top: snappedY,
      width: 150,
      height: 100,
      expanded: true,
    };

    switch (type) {
      case 'action':
        newView = {
          ...baseProps,
          type: 'button',
          data: { id: 'click', text: 'New Button' },
        } as ButtonView;
        break;
      case 'environment':
        newView = {
          ...baseProps,
          type,
          data: { id: generateUniqueId(), title: 'New View' },
        } as AnchoredView;
        break;
      case 'container':
        newView = {
          ...baseProps,
          type: 'container',
          data: { title: 'New Container' },
          views: [],
        } as ContainerView;
        break;
      default:
        return;
    }

    findAndAddView(view, view.id, newView);
    onViewUpdate?.(view.id, view);

  };

  const handleToggleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    view.expanded = !view.expanded;
    onViewUpdate?.(view.id, view);
  }, [view, onViewUpdate]);

  const className = cx(
    styles.windowView,
    isOver && styles.containerViewDragOver,
  );
  const body = <ContextMenu.Root>
    <ContextMenu.Trigger asChild>
      <div
        ref={setNodeRef}
        className={cx(
          styles.windowViewContent,
          isRootView && isOver && styles.containerViewDragOver,
        )}
      >
        {view.views.map((childView) => (
          <DraggableView
            key={childView.id}
            view={childView}
            parentView={view}
            updateTrigger={updateTrigger}
            onViewUpdate={onViewUpdate}
            relativeLeft={relativeLeft + view.left + (isRootView ? 0 : viewConstants.windowLeftDelta)}
            relativeTop={relativeTop + view.top + (isRootView ? 0 : viewConstants.windowTopDelta)}
            parentId={view.id}
            siblings={view.views}
            isOverlay={isOverlay}
            isUnderRootView={isRootView}
          />
        ))}
      </div>
    </ContextMenu.Trigger>

    <ContextMenu.Portal>
      <ContextMenu.Content className={styles.contextMenu}>
        <ContextMenu.Label className={styles.contextMenuLabel}>
          新建视图
        </ContextMenu.Label>
        <ContextMenu.Item
          className={styles.contextMenuItem}
          onSelect={(e) => handleCreateView('action', e as any)}
        >
          <Square style={{ width: '16px', height: '16px', marginRight: '8px' }} />
          按钮
        </ContextMenu.Item>
        <ContextMenu.Item
          className={styles.contextMenuItem}
          onSelect={(e) => handleCreateView('environment', e as any)}
        >
          <Link style={{ width: '16px', height: '16px', marginRight: '8px' }} />
          锚定视图
        </ContextMenu.Item>
        <ContextMenu.Item
          className={styles.contextMenuItem}
          onSelect={(e) => handleCreateView('container', e as any)}
        >
          <Container style={{ width: '16px', height: '16px', marginRight: '8px' }} />
          容器
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu.Portal>
  </ContextMenu.Root>;

  if (isRootView) {
    return body;
  }

  return (
    <div
      className={className}
    >
      <div
        className={styles.windowViewHeader}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button onClick={handleToggleExpand} className={styles.expandButton}>
            {view.expanded ? <ChevronDown style={{ width: '16px', height: '16px' }} /> : <ChevronRight style={{ width: '16px', height: '16px' }} />}
          </button>
          <span style={{ fontWeight: 500, fontSize: '14px' }}>{view.data?.title}</span>
        </div>
      </div>

      {view.expanded && body}
    </div>
  );
};