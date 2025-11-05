import { PropsWithChildren, ComponentType, ReactNode } from 'react';
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
    return <AdapterProvider {...adapterProps}>
      <CustomFilePickerProvider>
        <FakeModelPickerProvider>
          {children}
        </FakeModelPickerProvider>
      </CustomFilePickerProvider>
    </AdapterProvider>
  }

  return (
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
  );

}