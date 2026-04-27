import { PropsWithChildren } from 'react';
import { I18nProvider } from '@lingui/react';
import { i18n } from '@/i18n';
import { ScenarioStoreProvider } from '@/store/scenario/store';
import { useProjectStore } from '@/store/project';
import { TransportStoreProvider } from '@/store/transport';
import { ScenarioUndoRedoStoreProvider } from '@/store/undo-redo';
import { CreateNewProjectDialogAnchor } from './dialogs/CreateNewProjectDialog';
import { ToastAnchor } from '@/store/toast';

type ProvidersProps = PropsWithChildren;

export function Providers({
  children,
}: ProvidersProps) {

  const activeProject = useProjectStore((store) => store.activeProject);

  const projectProvider = activeProject
    ? <ScenarioStoreProvider value={activeProject.useScenarioStore}>
      <TransportStoreProvider value={activeProject.useTransportStore}>
        <ScenarioUndoRedoStoreProvider value={activeProject.useUndoRedoStore}>
          {children}
        </ScenarioUndoRedoStoreProvider>
      </TransportStoreProvider>
    </ScenarioStoreProvider>
    : children;


  return (
    <I18nProvider i18n={i18n}>
      {projectProvider}
      <CreateNewProjectDialogAnchor />
      <ToastAnchor />
    </I18nProvider>
  );

}