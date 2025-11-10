import { AnyView, ContainerView } from "@/types/ui"
import { createContext, useContext } from "react"
import { AnchoredViewRendererType, ViewContextMenuRendererType } from "./types";


export type ViewContextScheme = {
  isAdjusting: boolean,
  onButtonAction: (id: string) => void,
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
  onViewUpdate: (id: string, updatedView: AnyView) => void,
};

export const ViewContext = createContext<ViewContextScheme>({
  isAdjusting: false,
  onButtonAction: () => void 0,
  AnchoredViewRenderer: () => void 0,
  ViewContextMenuRenderer: () => void 0,
  onResizeStart: () => void 0,
  onViewUpdate: () => void 0,
});

export const useViewContext = () => useContext(ViewContext);