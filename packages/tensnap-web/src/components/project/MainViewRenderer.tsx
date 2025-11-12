import { useScenarioStore } from "@/store/scenario/store";
import { useButtonControls } from "../../hooks/useButtonControls";
import ViewRoot from "../view/ViewRoot";
import { AnchoredViewRenderer } from "./AnchoredViewRenderer";
import { useSettingsStore } from "@/store/settings";
import { ViewContextMenuRenderer } from "./ViewContextMenuRenderer";
import { useCreateView } from "./view-edit-hooks";
import { EmptyState } from "../ui/EmptyState";
import { Trans } from "@lingui/react/macro";
import { Radar } from "lucide-react";



export function MainViewRenderer() {
  const mainView = useScenarioStore((store) => store.mainView);

  const isAdjusting = useSettingsStore((store) => store.isAdjusting);

  const updateTrigger = useScenarioStore((store) => store.viewUpdateTrigger.value);
  const onUpdate = useScenarioStore((store) => store.viewUpdateTrigger.set);

  const { createView } = useCreateView({ onViewUpdate: onUpdate });

  const { handleButtonAction } = useButtonControls();

  if (!mainView) {
    return <EmptyState
      icon={<Radar size={64} />}
      title={<Trans>No main view available.</Trans>}
      description={<Trans>Please create or open a project to get started.</Trans>}
    />
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