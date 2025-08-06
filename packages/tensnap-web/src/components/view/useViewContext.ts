import { AlignmentGuides, AnchoredView } from "@/types/ui"
import React, { createContext, Dispatch, SetStateAction, useContext } from "react"


export type ViewContextScheme = {
  guides: AlignmentGuides,
  setGuides: Dispatch<SetStateAction<AlignmentGuides>>,
  onButtonAction: (id: string) => void,
  renderAnchoredView: React.FC<{
    type: AnchoredView['type'],
    id: string,
  }>,
};

export const ViewContext = createContext<ViewContextScheme>({
  guides: {
    horizontal: [], vertical: [],
  },
  setGuides: () => void 0,
  onButtonAction: () => void 0,
  renderAnchoredView: () => undefined,
});

export const useViewContext = () => useContext(ViewContext);