import { PropsWithChildren } from 'react';
import { I18nProvider } from '@lingui/react';
import { i18n } from '@/i18n';
import { ScenarioStoreProvider } from '@/store/scenario';
import { useProjectStore } from '@/store/project';
import { WebSocketStoreProvider } from '@/store/websocket';
import { ScenarioUndoRedoStoreProvider } from '@/store/undo-redo';
import { FakeModelPickerProvider } from 'tensnap-web-utils';

interface ProvidersProps extends PropsWithChildren<object> {

}

export function Providers({
  children,
}: ProvidersProps) {

  const { getActive } = useProjectStore();

  const activeProject = getActive();

  if (!activeProject) {
    return <I18nProvider i18n={i18n}>
      <FakeModelPickerProvider>
        {children}
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
            </ScenarioUndoRedoStoreProvider>
          </WebSocketStoreProvider>
        </ScenarioStoreProvider>
      </FakeModelPickerProvider>
    </I18nProvider>
  );

}