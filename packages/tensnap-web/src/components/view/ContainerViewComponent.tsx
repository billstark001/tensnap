import React, { useCallback, useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { ChevronDown, ChevronRight, Square, Container, Pyramid, Earth, ChartArea } from 'lucide-react';
import { ContainerView, AnyView } from '@/types/ui';
import { DraggableView } from './DraggableView';
import * as styles from './styles.css';
import { viewConstants } from './constants';
import cx from 'clsx';
import { ViewProps } from './types';
import { useViewContext } from './useViewContext';
import ContextMenu from '@tensnap/web-common/components/ui/ContextMenu';
import { Trans } from '@lingui/react/macro';
import { toggleViewExpandedInPlace } from '@/utils/view/mutation';

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


  const { rootView, onViewCreateRequest, onViewUpdate, isAdjusting } = useViewContext();

  const data = {
    view,
    containerId: view.id,
    relativeLeft: relativeLeft + view.left + (isRootView ? 0 : viewConstants.windowLeftDelta),
    relativeTop: relativeTop + view.top + (isRootView ? 0 : viewConstants.windowTopDelta),
  };

  const { setNodeRef, isOver } = useDroppable({
    id: `container-${view.id}`,
    data,
    disabled: isOverlay,
  });

  const lastClickPositionRef = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    lastClickPositionRef.current = {
      x: Math.max(0, Math.round(e.clientX - rect.left)),
      y: Math.max(0, Math.round(e.clientY - rect.top)),
    };
  }, [lastClickPositionRef]);

  const handleCreateView = useCallback((type: AnyView['type'], e: React.MouseEvent) => {
    e.stopPropagation();
    onViewCreateRequest(type, lastClickPositionRef.current, view);
  }, [onViewCreateRequest, view]);

  const handleToggleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (!rootView) return;
    toggleViewExpandedInPlace({ rootView, onViewUpdate }, view);
  }, [rootView, view, onViewUpdate]);

  const className = cx(
    styles.windowView,
    isOver && styles.containerViewDragOver,
  );

  const viewList = useMemo(() => view.views.map((childView) => (
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
  )), [view, updateTrigger, relativeLeft, relativeTop, isRootView, isOverlay]);

  const draggableView = <div
    ref={setNodeRef}
    className={cx(
      styles.windowViewContent,
      isRootView && isOver && styles.containerViewDragOver,
    )}
    onContextMenu={handleContextMenu}
  >
    {viewList}
  </div>;

  const contextMenuItems = useMemo(() => (
    <>
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
    </>
  ), [handleCreateView]);

  const body = (
    <ContextMenu.Root trigger={draggableView} disabled={!isAdjusting}>
      {contextMenuItems}
    </ContextMenu.Root>
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
