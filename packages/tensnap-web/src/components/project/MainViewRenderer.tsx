import { useScenarioStore } from "@/store/scenario/store";
import { createUpdateTriggerStore } from "@/store/update-trigger";
import { useButtonControls } from "../../hooks/useButtonControls";
import ViewRoot from "../view/ViewRoot";
import { AnchoredViewRenderer } from "./AnchoredViewRenderer";
import { useSettingsStore } from "@/store/settings";

const useUpdateTriggerStore = createUpdateTriggerStore();

export function MainViewRenderer() {
  const mainView = useScenarioStore((store) => store.mainView);

  const isAdjusting = useSettingsStore((store) => store.isAdjusting);

  const updateTrigger = useUpdateTriggerStore((store) => store.updateTrigger);
  const onUpdate = useUpdateTriggerStore((store) => store.onUpdate);

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
      renderAnchoredView={AnchoredViewRenderer}
      onButtonAction={handleButtonAction}
    />
  );
}