import { useState, useCallback, useEffect } from 'react';
import { ProjectScope } from '../ProjectScope';
import { useProjectStore } from '../store/project';
import { useSettingsStore } from '../store/settings';
import { SettingsDialog } from './SettingsDialog';

/** Each invocation captures a real project, including calls from an auxiliary window. */
function SettingsInvocation() {
  const close = useSettingsStore((state) => state.setSettingsDialogOpen);
  const [project] = useState(() => {
    const id = useSettingsStore.getState().settingsDialogProjectId;
    const state = useProjectStore.getState();
    return state.projects.find((entry) => entry.id === id) ?? null;
  });
  const requested = useSettingsStore.getState().settingsDialogProjectId;
  const onMissing = useCallback(() => close(false), [close]);
  useEffect(() => {
    if (requested != null && !project) onMissing();
  }, [requested, project, onMissing]);
  if (requested != null && !project) return null;
  return (
    <ProjectScope project={project} onMissing={onMissing}>
      <SettingsDialog open onOpenChange={close} />
    </ProjectScope>
  );
}

export function SettingsDialogAnchor() {
  const open = useSettingsStore((state) => state.settingsDialogOpen);
  const request = useSettingsStore((state) => state.settingsDialogRequest);
  return open ? <SettingsInvocation key={request} /> : null;
}
