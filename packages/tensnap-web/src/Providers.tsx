import { PropsWithChildren } from 'react';
import { I18nProvider } from '@lingui/react';
import { i18n } from '@/i18n';
import { ScenarioStoreProvider } from '@/store/scenario/store';
import { useProjectStore } from '@/store/project';
import { WebSocketStoreProvider } from '@/store/websocket';
import { ScenarioUndoRedoStoreProvider } from '@/store/undo-redo';
import { FakeModelPickerProvider } from 'tensnap-web-utils';
import { CreateNewProjectDialogAnchor } from './dialogs/CreateNewProjectDialog';

interface ProvidersProps extends PropsWithChildren<object> {

}

export function Providers({
  children,
}: ProvidersProps) {

  const activeProject = useProjectStore((store) => store.activeProject);

  if (!activeProject) {
    return <I18nProvider i18n={i18n}>
      <FakeModelPickerProvider>
        {children}
        <CreateNewProjectDialogAnchor />
      </FakeModelPickerProvider>
    </I18nProvider>
  }

  return (
    <I18nProvider i18n={i18n}>
      <FakeModelPickerProvider>
        <ScenarioStoreProvider value={activeProject.useScenarioStore}>
          <WebSocketStoreProvider value={activeProject.useWebSocketStore}>
            <ScenarioUndoRedoStoreProvider value={activeProject.useUndoRedoStore}>
              {children}
              <CreateNewProjectDialogAnchor />
            </ScenarioUndoRedoStoreProvider>
          </WebSocketStoreProvider>
        </ScenarioStoreProvider>
      </FakeModelPickerProvider>
    </I18nProvider>
  );

}