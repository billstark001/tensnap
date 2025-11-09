import { PropsWithChildren } from 'react';
import { I18nProvider } from '@lingui/react';
import { i18n } from '@/i18n';
import { ScenarioStoreProvider } from '@/store/scenario/store';
import { useProjectStore } from '@/store/project';
import { WebSocketStoreProvider } from '@/store/websocket';
import { ScenarioUndoRedoStoreProvider } from '@/store/undo-redo';
import { CreateNewProjectDialogAnchor } from './dialogs/CreateNewProjectDialog';

interface ProvidersProps extends PropsWithChildren<object> {

}

export function Providers({
  children,
}: ProvidersProps) {

  const activeProject = useProjectStore((store) => store.activeProject);

  const projectProvider = activeProject
    ? <ScenarioStoreProvider value={activeProject.useScenarioStore}>
      <WebSocketStoreProvider value={activeProject.useWebSocketStore}>
        <ScenarioUndoRedoStoreProvider value={activeProject.useUndoRedoStore}>
          {children}
        </ScenarioUndoRedoStoreProvider>
      </WebSocketStoreProvider>
    </ScenarioStoreProvider>
    : children;


  return (
    <I18nProvider i18n={i18n}>
      {projectProvider}
      <CreateNewProjectDialogAnchor />
    </I18nProvider>
  );

}