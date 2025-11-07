import { AnchoredView } from "@/types/ui"
import React, { createContext, useContext } from "react"


export type ViewContextScheme = {
  onButtonAction: (id: string) => void,
  renderAnchoredView: React.FC<{
    type: AnchoredView['type'],
    id: string,
  }>,
};

export const ViewContext = createContext<ViewContextScheme>({
  onButtonAction: () => void 0,
  renderAnchoredView: () => undefined,
});

export const useViewContext = () => useContext(ViewContext);