import { AnyView, ContainerView } from "@/types/ui"
import { createContext, useContext } from "react"
import { AnchoredViewRendererType, Point, ViewContextMenuRendererType } from "./types";


export type ViewContextScheme = {
  isAdjusting: boolean,
  onButtonAction: (id: string, continuous?: boolean) => void,
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
  onViewCreateRequest: (type: AnyView['type'], position: Point, container: ContainerView,) => void,
  onViewUpdate: (id: string, updatedView: AnyView) => void,
};

export const ViewContext = createContext<ViewContextScheme>({
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