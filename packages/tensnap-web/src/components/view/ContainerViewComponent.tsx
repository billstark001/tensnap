import React, { useCallback } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { ChevronDown, ChevronRight, Square, Container, Pyramid, Earth, ChartArea } from 'lucide-react';
import { ContainerView, AnyView, ButtonView, AnchoredView } from '@/types/ui';
import { generateUniqueId } from '@/utils/common';
import { DraggableView } from './DraggableView';
import * as styles from './styles.css';
import { viewConstants } from './constants';
import cx from 'clsx';
import { ViewProps } from './types';
import { findAndAddView } from './utils/container';
import { useViewContext } from './useViewContext';
import ContextMenu from '../ui/ContextMenu';
import { Trans } from '@lingui/react/macro';

interface ContainerViewComponentProps extends ViewProps<ContainerView> {
  relativeLeft?: number,
  relativeTop?: number,
  isOverlay?: boolean;
  isRootView?: boolean;
}

export const ContainerViewComponent: React.FC<ContainerViewComponentProps> = ({
  view,
  updateTrigger,
  relativeLeft = 0,
  relativeTop = 0,
  isOverlay = false,
  isRootView = false,
}) => {

  const { onViewUpdate, isAdjusting } = useViewContext();

  const { setNodeRef, isOver } = useDroppable({
    id: `container-${view.id}`,
    data: {
      view,
      containerId: view.id,
      relativeLeft: relativeLeft + view.left + (isRootView ? 0 : viewConstants.windowLeftDelta),
      relativeTop: relativeTop + view.top + (isRootView ? 0 : viewConstants.windowTopDelta),
    },
    disabled: isOverlay,
  });

  const lastClickPositionRef = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    lastClickPositionRef.current = { x: e.nativeEvent.offsetX || 0, y: e.nativeEvent.offsetY || 0 };
  }, [lastClickPositionRef]);

  const handleCreateView = (type: AnyView['type'], e: React.MouseEvent) => {
    e.stopPropagation();
    let newView: AnyView;
    const baseProps = {
      id: generateUniqueId(),
      type,
      left: lastClickPositionRef.current.x,
      top: lastClickPositionRef.current.y,
      expanded: true,
    };

    switch (type) {
      case 'button':
        newView = {
          ...baseProps,
          width: 120,
          height: 40,
          data: { id: 'click', text: 'New Button' },
        } as ButtonView;
        break;
      case 'parameter':
        newView = {
          ...baseProps,
          width: 200,
          height: 80,
          data: { id: generateUniqueId(), title: 'New Parameter', type: 'boolean' },
        } as AnchoredView;
        break;
      case 'chart':
        newView = {
          ...baseProps,
          width: 300,
          height: 200,
          data: { id: generateUniqueId(), title: 'New Chart', type: 'line' },
        } as AnchoredView;
        break;
      case 'environment':
        newView = {
          ...baseProps,
          width: 200,
          height: 200,
          data: { id: generateUniqueId(), title: 'New View' },
        } as AnchoredView;
        break;
      case 'container':
        newView = {
          ...baseProps,
          width: 300,
          height: 300,
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

  const draggableView = <div
    ref={setNodeRef}
    className={cx(
      styles.windowViewContent,
      isRootView && isOver && styles.containerViewDragOver,
    )}
    onContextMenu={handleContextMenu}
  >
    {view.views.map((childView) => (
      <DraggableView
        key={childView.id}
        view={childView}
        parentView={view}
        updateTrigger={updateTrigger}
        relativeLeft={relativeLeft + view.left + (isRootView ? 0 : viewConstants.windowLeftDelta)}
        relativeTop={relativeTop + view.top + (isRootView ? 0 : viewConstants.windowTopDelta)}
        parentId={view.id}
        siblings={view.views}
        isOverlay={isOverlay}
        isUnderRootView={isRootView}
      />
    ))}
  </div>;

  const body = isAdjusting ? (
    <ContextMenu.Root trigger={draggableView} >
      <ContextMenu.Label>
        <Trans>New View</Trans>
      </ContextMenu.Label>
      <ContextMenu.Item
        onSelect={(e) => handleCreateView('button', e as any)}
      >
        <Square />
        <Trans>Button</Trans>
      </ContextMenu.Item>
      <ContextMenu.Item
        onSelect={(e) => handleCreateView('parameter', e as any)}
      >
        <Pyramid />
        <Trans>Parameter</Trans>
      </ContextMenu.Item>
      <ContextMenu.Item
        onSelect={(e) => handleCreateView('environment', e as any)}
      >
        <Earth />
        <Trans>Environment</Trans>
      </ContextMenu.Item>
      <ContextMenu.Item
        onSelect={(e) => handleCreateView('chart', e as any)}
      >
        <ChartArea />
        <Trans>Chart</Trans>
      </ContextMenu.Item>
      <ContextMenu.Item
        onSelect={(e) => handleCreateView('container', e as any)}
      >
        <Container />
        <Trans>Container</Trans>
      </ContextMenu.Item>
    </ContextMenu.Root>) : (
    draggableView
  );

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
        <button onClick={handleToggleExpand} className={styles.expandButton}>
          {view.expanded ? <ChevronDown className='icon' /> : <ChevronRight className='icon' />}
        </button>
        <span className={styles.windowViewTitle}>{view.data?.title}</span>
      </div>

      {view.expanded && body}
    </div>
  );
};