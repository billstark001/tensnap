import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import * as styles from './styles.css';
import { ContainerView } from '@/types/ui';
import { ContainerViewComponent } from './ContainerViewComponent';
import { nestedOverlapCollisionDetection } from './utils/collision';
import { ViewContext, ViewContextScheme } from './useViewContext';
import { useCallbackRef } from '@/utils/react';
import { ViewProps } from './types';
import { viewConstants } from './constants';
import { Guidelines } from './GuideLines';
import clsx from 'clsx';
import { useDragContent, useResizeContent } from './useDragAndResizeContent';
import { PropsWithChildren, useMemo } from 'react';

export type ViewRendererProps = ViewProps<ContainerView> &
  Partial<ViewContextScheme>;

const NaiveRenderer = (props: PropsWithChildren<object>) => {
  return <>{props.children}</>;
}

export default function ViewRoot({
  view: rootView,
  updateTrigger,
  isAdjusting = false,
  onViewCreateRequest: _onViewCreateRequest,
  onViewUpdate: _onViewUpdate,
  onButtonAction: _onButtonAction,
  AnchoredViewRenderer: _AnchoredViewRenderer,
  ViewContextMenuRenderer: _ViewContextMenuRenderer,
}: ViewRendererProps) {

  const onButtonAction = useCallbackRef(_onButtonAction ?? (() => void 0));
  const onViewUpdate = useCallbackRef(_onViewUpdate ?? (() => void 0));
  const onViewCreateRequest = useCallbackRef(_onViewCreateRequest ?? (() => void 0));

  const AnchoredViewRenderer = useCallbackRef(_AnchoredViewRenderer ?? NaiveRenderer as any);
  const ViewContextMenuRenderer = useCallbackRef(_ViewContextMenuRenderer ?? NaiveRenderer as any);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor)
  );

  // drag
  const {
    dragState,
    onDragStart,
    onDragMove,
    onDragEnd,
  } = useDragContent({
    rootView,
    onViewUpdate,
  });

  const { state } = dragState;

  // resize
  const {
    resizeState,
    onResizeStart,
  } = useResizeContent({
    rootView,
    onViewUpdate,
  });

  const contextValue: ViewContextScheme = useMemo(() => ({
    isAdjusting,
    onButtonAction,
    AnchoredViewRenderer,
    ViewContextMenuRenderer,
    onResizeStart,
    onViewUpdate,
    onViewCreateRequest,
  }), [isAdjusting, onButtonAction, AnchoredViewRenderer, ViewContextMenuRenderer, onResizeStart, onViewUpdate, onViewCreateRequest]);

  const { state: resizeStateValue } = resizeState;

  return (
    <ViewContext.Provider value={contextValue}>
      <DndContext
        sensors={sensors}
        collisionDetection={nestedOverlapCollisionDetection}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        modifiers={[restrictToWindowEdges]}
      >
        <div className={styles.container}>
          <div className={styles.rootView} style={{ width: rootView.width, height: rootView.height }}>
            <ContainerViewComponent
              view={rootView}
              updateTrigger={updateTrigger}
              isRootView
            />

            {state.guideLines.length > 0 && (
              <Guidelines
                style={{ width: rootView.width, height: rootView.height }}
                guidelines={state.guideLines}
                leftShift={state.guideOrigin.relativeLeft}
                topShift={state.guideOrigin.relativeTop}
              />
            )}

            {state.suggestedSnap && (
              <div
                className={clsx(styles.dragOverlay, 'snap')}
                style={{
                  width: state.suggestedSnap.width,
                  height: state.suggestedSnap.height,
                  left: state.guideOrigin.relativeLeft + state.suggestedSnap.left,
                  top: state.guideOrigin.relativeTop + state.suggestedSnap.top,
                }}
              />
            )}

            {/* Resize guidelines and snap preview */}
            {resizeStateValue.guideLines.length > 0 && (
              <Guidelines
                style={{ width: rootView.width, height: rootView.height }}
                guidelines={resizeStateValue.guideLines}
                leftShift={resizeStateValue.guideOrigin.relativeLeft}
                topShift={resizeStateValue.guideOrigin.relativeTop}
              />
            )}

            {resizeStateValue.suggestedSnap && (
              <div
                className={clsx(styles.dragOverlay, 'snap')}
                style={{
                  width: resizeStateValue.suggestedSnap.width,
                  height: resizeStateValue.suggestedSnap.height,
                  left: resizeStateValue.guideOrigin.relativeLeft + resizeStateValue.suggestedSnap.left,
                  top: resizeStateValue.guideOrigin.relativeTop + resizeStateValue.suggestedSnap.top,
                }}
              />
            )}
          </div>
        </div>

        <DragOverlay>
          {state.content && (
            <div
              className={styles.dragOverlayAnchor}
              style={{
                width: state.content.mouseX + viewConstants.dragHandleContentDelta,
                height: state.content.mouseY + viewConstants.dragHandleContentDelta,
              }}
            >
              <div
                className={clsx(styles.dragOverlay, state.suggestedSnap && 'snapping')}
                style={{
                  width: state.content.view.width,
                  height: state.content.view.height,
                }}
              />
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </ViewContext.Provider>
  );
}