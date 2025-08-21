import { AnchoredView } from "@/types/ui"
import React, { createContext, Dispatch, SetStateAction, useContext } from "react"
import { GuidePointSet } from "./utils/snap-module";


export type ViewContextScheme = {
  guides: GuidePointSet,
  setGuides: Dispatch<SetStateAction<GuidePointSet>>,
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