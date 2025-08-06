import React from 'react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { ChevronDown, ChevronRight, Square, Link, Container } from 'lucide-react';
import { ContainerView, AnyView, ButtonView, AnchoredView } from '@/types/ui';
import { generateUniqueId, snapToGrid } from './utils';
import { DraggableView } from './DraggableView';
import * as styles from './styles.css';

interface DroppableContainerProps {
  view: ContainerView;
  onUpdate: (viewId: string, updates: Partial<AnyView>) => void;
  onDelete: (viewId: string) => void;
  onAddView: (parentId: string, newView: AnyView) => void;
  onToggleExpand: (e: React.MouseEvent) => void;
}

export const DroppableContainer: React.FC<DroppableContainerProps> = ({
  view,
  onUpdate,
  onDelete,
  onAddView,
  onToggleExpand
}) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `container-${view.id}`,
    data: { containerId: view.id },
  });

  const { attributes, listeners, setNodeRef: setDragRef, transform } = useDraggable({
    id: view.id,
    data: { view },
  });

  const containerStyle: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
  };

  const handleCreateView = (type: 'button' | 'environment' | 'container', e: React.MouseEvent) => {
    e.stopPropagation();
    const containerRect = (e.currentTarget as HTMLElement).closest(`.${styles.containerViewContent}`)?.getBoundingClientRect();
    
    const relativeX = containerRect ? e.clientX - containerRect.left : 50;
    const relativeY = containerRect ? e.clientY - containerRect.top : 50;

    // Snap to grid
    const snappedX = snapToGrid(Math.max(0, relativeX - 75));
    const snappedY = snapToGrid(Math.max(0, relativeY - 50));

    let newView: AnyView;
    const baseProps = {
      id: generateUniqueId(),
      left: snappedX,
      top: snappedY,
      width: snapToGrid(150),
      height: snapToGrid(100),
      expanded: true,
    };

    switch (type) {
      case 'button':
        newView = {
          ...baseProps,
          type: 'button',
          data: { operation: 'click', text: 'New Button' },
        } as ButtonView;
        break;
      case 'environment':
        newView = {
          ...baseProps,
          type: 'environment',
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

  const className = `${styles.containerView} ${isOver ? styles.containerViewDragOver : ''}`;

  return (
    <div
      ref={setNodeRef}
      className={className}
      style={containerStyle}
    >
      <div
        ref={setDragRef}
        {...listeners}
        {...attributes}
        className={styles.containerViewHeader}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button onClick={onToggleExpand} className={styles.expandButton}>
            {view.expanded ? <ChevronDown style={{ width: '16px', height: '16px' }} /> : <ChevronRight style={{ width: '16px', height: '16px' }} />}
          </button>
          <span style={{ fontWeight: 500, fontSize: '14px' }}>{view.data?.title}</span>
        </div>
      </div>
      
      {view.expanded && (
        <ContextMenu.Root>
          <ContextMenu.Trigger asChild>
            <div className={styles.containerViewContent}>
              {view.views.map((childView) => (
                <DraggableView
                  key={childView.id}
                  view={childView}
                  parentId={view.id}
                  onUpdate={onUpdate}
                  onDelete={onDelete}
                  onAddView={onAddView}
                  siblings={view.views}
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
                onSelect={(e) => handleCreateView('button', e as any)}
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
        </ContextMenu.Root>
      )}
    </div>
  );
};