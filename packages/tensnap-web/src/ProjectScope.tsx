import { useMemo, useEffect, type ReactNode } from 'react';
import { DialogScopeContext, type DialogScope } from '@tensnap/web-common/workbench/dialog-content';
import { useProjectStore, type ProjectContextScheme } from './store/project';
import { ProjectContext } from './store/project-context';
import { ScenarioStoreProvider } from './store/scenario/store';
import { TransportStoreProvider } from './store/transport';
import { ScenarioUndoRedoStoreProvider } from './store/undo-redo';

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

export function ProjectScope({
  project,
  children,
  onMissing,
}: {
  project: ProjectContextScheme | null;
  children: ReactNode;
  onMissing?: () => void;
}) {
  const scope = useMemo(() => {
    const value: DialogScope = {
      id: project?.id ?? null,
      render: (content, onClose) => (
        <DialogScopeContext.Provider value={value}>
          <ProjectServices project={project} onMissing={onClose}>
            {content}
          </ProjectServices>
        </DialogScopeContext.Provider>
      ),
    };
    return value;
  }, [project]);
  return (
    <DialogScopeContext.Provider value={scope}>
      <ProjectServices project={project} onMissing={onMissing}>
        {children}
      </ProjectServices>
    </DialogScopeContext.Provider>
  );
}
