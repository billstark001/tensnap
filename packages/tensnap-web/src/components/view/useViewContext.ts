import { AnchoredView, AnyView, ContainerView } from "@/types/ui"
import React, { createContext, useContext } from "react"


export type ViewContextScheme = {
  isAdjusting: boolean,
  onButtonAction: (id: string) => void,
  renderAnchoredView: React.FC<{
    type: AnchoredView['type'],
    id: string,
  }>,
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
  renderAnchoredView: () => void 0,
  onResizeStart: () => void 0,
  onViewUpdate: () => void 0,
});

export const useViewContext = () => useContext(ViewContext);