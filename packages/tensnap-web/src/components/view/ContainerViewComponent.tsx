import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { ChevronDown, ChevronRight, Square, Link, Container } from 'lucide-react';
import { ContainerView, AnyView, ButtonView, AnchoredView } from '@/types/ui';
import { generateUniqueId } from '@/utils/common';
import { DraggableView } from './DraggableView';
import * as styles from './styles.css';
import { LEFT_DELTA, TOP_DELTA } from './constants';
import cx from 'clsx';

interface ContainerViewComponentProps {
  view: ContainerView;
  relativeLeft?: number,
  relativeTop?: number,
  onUpdate: (viewId: string, updates: Partial<AnyView>) => void;
  onDelete: (viewId: string) => void;
  onAddView: (parentId: string, newView: AnyView) => void;
  onToggleExpand: (e: React.MouseEvent) => void;
  isOverlay?: boolean;
  isRootView?: boolean;
}

export const ContainerViewComponent: React.FC<ContainerViewComponentProps> = ({
  view,
  relativeLeft = 0,
  relativeTop = 0,
  onUpdate,
  onDelete,
  onAddView,
  onToggleExpand,
  isOverlay = false,
  isRootView = false,
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `container-${view.id}`,
    data: {
      containerId: view.id,
      relativeLeft: relativeLeft + view.left + LEFT_DELTA,
      relativeTop: relativeTop + view.top + TOP_DELTA,
    },
    disabled: isOverlay,
  });

  const handleCreateView = (type: 'action' | 'environment' | 'container', e: React.MouseEvent) => {
    e.stopPropagation();
    const containerRect = (e.currentTarget as HTMLElement).closest(`.${styles.windowViewContent}`)?.getBoundingClientRect();

    const relativeX = containerRect ? e.clientX - containerRect.left : 50;
    const relativeY = containerRect ? e.clientY - containerRect.top : 50;

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

    onAddView(view.id, newView);
  };

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
            relativeLeft={relativeLeft + view.left + LEFT_DELTA}
            relativeTop={relativeTop + view.top + TOP_DELTA}
            parentId={view.id}
            onUpdate={onUpdate}
            onDelete={onDelete}
            onAddView={onAddView}
            siblings={view.views}
            isOverlay={isOverlay}
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
          <button onClick={onToggleExpand} className={styles.expandButton}>
            {view.expanded ? <ChevronDown style={{ width: '16px', height: '16px' }} /> : <ChevronRight style={{ width: '16px', height: '16px' }} />}
          </button>
          <span style={{ fontWeight: 500, fontSize: '14px' }}>{view.data?.title}</span>
        </div>
      </div>

      {view.expanded && body}
    </div>
  );
};