import { AnyView, ContainerView } from "@/types/ui"
import { createContext, useContext } from "react"
import { AnchoredViewRendererType, Point, ViewContextMenuRendererType } from "./types";
import type { RunSpec } from '@tensnap/core/runtime';

/**
 * @param view the original view. `view.id ===  updateView.id` is guaranteed if updateView is passed.
 * @param updatedView if passed, the view's reference is changed. Else, the view is changed in-place.
 */
export type ViewUpdateHandler = (view: AnyView, updatedView?: AnyView) => void;
export type ViewCreateRequestHandler = (type: AnyView['type'], position: Point, container: ContainerView,) => void;

export type ViewContextScheme = {
  rootView: ContainerView | null,
  isAdjusting: boolean,
  onButtonAction: (id: string, continuous?: boolean, runSpec?: Omit<RunSpec, 'actionId'>) => void,
  isRunning: (id: string) => boolean,
  AnchoredViewRenderer: AnchoredViewRendererType,
  ViewContextMenuRenderer: ViewContextMenuRendererType,
  onResizeStart: (
    view: AnyView, 
    parentView: ContainerView, 
    direction: string, 
    relativeLeft: number, 
    relativeTop: number, 
    clientX: number, 
    clientY: number
  ) => void,
  onViewCreateRequest: ViewCreateRequestHandler;
  onViewUpdate: ViewUpdateHandler;
};

export const ViewContext = createContext<ViewContextScheme>({
  rootView: null,
  isAdjusting: false,
  onButtonAction: () => void 0,
  isRunning: () => false,
  AnchoredViewRenderer: () => void 0,
  ViewContextMenuRenderer: () => void 0,
  onResizeStart: () => void 0,
  onViewCreateRequest: () => void 0,
  onViewUpdate: () => void 0,
});

export const useViewContext = () => useContext(ViewContext);
