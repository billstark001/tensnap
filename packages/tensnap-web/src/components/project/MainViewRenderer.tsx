import { useScenarioStore } from "@/store/scenario/store";
import { useButtonControls } from "../../hooks/useButtonControls";
import ViewRoot from "../view/ViewRoot";
import { AnchoredViewRenderer } from "./AnchoredViewRenderer";
import { useSettingsStore } from "@/store/settings";
import { ViewContextMenuRenderer } from "./ViewContextMenuRenderer";
import { useCreateView } from "./view-edit-hooks";

export function MainViewRenderer() {
  const mainView = useScenarioStore((store) => store.mainView);

  const isAdjusting = useSettingsStore((store) => store.isAdjusting);

  const updateTrigger = useScenarioStore((store) => store.viewUpdateTrigger.value);
  const onUpdate = useScenarioStore((store) => store.viewUpdateTrigger.set);

  const { createView } = useCreateView({ onViewUpdate: onUpdate });

  const { handleButtonAction } = useButtonControls();

  if (!mainView) {
    return <div>No main view available.</div>;
  }

  return (
    <ViewRoot
      view={mainView}
      isAdjusting={isAdjusting}
      updateTrigger={updateTrigger}
      onViewUpdate={onUpdate}
      onViewCreateRequest={createView}
      AnchoredViewRenderer={AnchoredViewRenderer}
      ViewContextMenuRenderer={ViewContextMenuRenderer}
      onButtonAction={handleButtonAction}
    />
  );
}