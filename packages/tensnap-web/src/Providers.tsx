import { PropsWithChildren, ComponentType, ReactNode } from 'react';
import { I18nProvider } from '@lingui/react';
import { i18n } from '@/i18n';
import { ScenarioStoreProvider } from '@/store/scenario';
import { AdapterProvider, AdapterProviderProps } from '@/store/file-system/provider';
import { useProjectStore } from '@/store/project';
import { WebSocketStoreProvider } from '@/store/websocket';
import { ScenarioUndoRedoStoreProvider } from '@/store/undo-redo';
import { FilePickerProvider } from 'tensnap-web-utils/file-system';
import { FakeModelPickerProvider } from 'tensnap-web-utils';

interface ProvidersProps extends PropsWithChildren<object> {
  adapterProviderProps?: Partial<AdapterProviderProps>;
  filePickerProvider?: ComponentType<{ children: ReactNode }>;
}

export function Providers({ 
  children, 
  adapterProviderProps,
  filePickerProvider: CustomFilePickerProvider = FilePickerProvider
}: ProvidersProps) {

  const { getActive } = useProjectStore();

  const activeProject = getActive();

  const adapterProps = {
    preferredAdapter: "indexeddb",
    ...adapterProviderProps
  };

  if (!activeProject) {
    return <I18nProvider i18n={i18n}>
      <AdapterProvider {...adapterProps}>
        <CustomFilePickerProvider>
          <FakeModelPickerProvider>
            {children}
          </FakeModelPickerProvider>
        </CustomFilePickerProvider>
      </AdapterProvider>
    </I18nProvider>
  }

  return (
    <I18nProvider i18n={i18n}>
      <AdapterProvider {...adapterProps}>
        <CustomFilePickerProvider>
          <FakeModelPickerProvider>
            <ScenarioStoreProvider value={activeProject.useScenarioStore}>
              <WebSocketStoreProvider value={activeProject.useWebSocketStore}>
                <ScenarioUndoRedoStoreProvider value={activeProject.useUndoRedoStore}>
                  {children}
                </ScenarioUndoRedoStoreProvider>
              </WebSocketStoreProvider>
            </ScenarioStoreProvider>
          </FakeModelPickerProvider>
        </CustomFilePickerProvider>
      </AdapterProvider>
    </I18nProvider>
  );

}