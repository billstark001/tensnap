import { PropsWithChildren } from 'react';
import { ScenarioStoreProvider } from '../store/scenario';
import { AdapterProvider } from '@/store/file-system/provider';
import { useProjectStore } from '@/store/project';
import { WebSocketStoreProvider } from '@/store/websocket';
import { ScenarioUndoRedoStoreProvider } from '@/store/undo-redo';


export function Providers({ children }: PropsWithChildren<object>) {

  const { getActive } = useProjectStore();

  const activeProject = getActive();

  if (!activeProject) {
    return <AdapterProvider preferredAdapter="indexeddb">
      {children}
    </AdapterProvider>
  }

  return (
    <AdapterProvider preferredAdapter="indexeddb">
      <ScenarioStoreProvider value={activeProject.useScenarioStore}>
        <WebSocketStoreProvider value={activeProject.useWebSocketStore}>
          <ScenarioUndoRedoStoreProvider value={activeProject.useUndoRedoStore}>
            {children}
          </ScenarioUndoRedoStoreProvider>
        </WebSocketStoreProvider>
      </ScenarioStoreProvider>
    </AdapterProvider>
  );

}