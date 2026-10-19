import { SelectRecordingDialogAnchor } from './dialogs/SelectRecordingDialogStore';
import { useMemo, useEffect, type ReactNode, type PropsWithChildren } from 'react';
import { DialogScopeContext, type DialogScope } from '@tensnap/web-common/workbench/dialog-content';
import type { ProjectContextScheme } from './store/project';
import { I18nProvider } from '@lingui/react';
import { i18n } from '@/i18n';
import { ScenarioStoreProvider } from '@/store/scenario/store';
import { useProjectStore } from '@/store/project';
import { TransportStoreProvider } from '@/store/transport';
import { ScenarioUndoRedoStoreProvider } from '@/store/undo-redo';
import { CreateNewProjectDialogAnchor } from './dialogs/CreateNewProjectDialogStore';
import { DiscardProjectChangesDialog } from './dialogs/DiscardProjectChangesDialog';
import { ToastAnchor } from '@/store/toast';

type ProvidersProps = PropsWithChildren;

import { ProjectContext } from './store/project-context';

function ProjectServices({
  project,
  children,
  onMissing,
}: {
  project: ProjectContextScheme | null;
  children: ReactNode;
  onMissing?: () => void;
}) {
  const alive = useProjectStore(
    (state) => !project || state.projects.some((entry) => entry.id === project.id),
  );
  useEffect(() => {
    if (!alive) onMissing?.();
  }, [alive, onMissing]);
  if (!alive) return null;
  const content = project ? (
    <ScenarioStoreProvider value={project.useScenarioStore}>
      <TransportStoreProvider value={project.useTransportStore}>
        <ScenarioUndoRedoStoreProvider value={project.useUndoRedoStore}>
          {children}
        </ScenarioUndoRedoStoreProvider>
      </TransportStoreProvider>
    </ScenarioStoreProvider>
  ) : (
    children
  );
  return <ProjectContext.Provider value={project}>{content}</ProjectContext.Provider>;
}

export function Providers({ children }: ProvidersProps) {
  const activeProject = useProjectStore((store) => store.activeProject);
  const scope = useMemo(() => {
    const value: DialogScope = {
      id: activeProject?.id ?? null,
      render: (content, onClose) => (
        <DialogScopeContext.Provider value={value}>
          <ProjectServices project={activeProject} onMissing={onClose}>
            {content}
          </ProjectServices>
        </DialogScopeContext.Provider>
      ),
    };
    return value;
  }, [activeProject]);
  return (
    <I18nProvider i18n={i18n}>
      <DialogScopeContext.Provider value={scope}>
        <ProjectServices project={activeProject}>{children}</ProjectServices>
        <CreateNewProjectDialogAnchor />
        <SelectRecordingDialogAnchor />
        <DiscardProjectChangesDialog />
        <ToastAnchor />
      </DialogScopeContext.Provider>
    </I18nProvider>
  );
}
