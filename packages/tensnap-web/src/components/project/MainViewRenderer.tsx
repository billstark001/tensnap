import { useScenarioStore } from "@/store/scenario";
import { createUpdateTriggerStore } from "@/store/update-trigger";
import { useButtonControls } from "../useButtonControls";
import ViewRoot from "../view/ViewRoot";
import { AnchoredViewRenderer } from "./AnchoredViewRenderer";

const useUpdateTriggerStore = createUpdateTriggerStore();

export function MainViewWrapper() {
  const mainView = useScenarioStore((store) => store.mainView);

  const updateTrigger = useUpdateTriggerStore((store) => store.updateTrigger);
  const onUpdate = useUpdateTriggerStore((store) => store.onUpdate);

  const { handleButtonAction } = useButtonControls();

  if (!mainView) {
    return <div>No main view available.</div>;
  }

  return (
    <ViewRoot
      view={mainView}
      updateTrigger={updateTrigger}
      onViewUpdate={onUpdate}
      renderAnchoredView={AnchoredViewRenderer}
      onButtonAction={handleButtonAction}
    />
  );
}