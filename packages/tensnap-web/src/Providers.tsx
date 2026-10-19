import type { PropsWithChildren } from 'react';
import { ProjectScope } from './ProjectScope';
import { SelectRecordingDialogAnchor } from './dialogs/SelectRecordingDialogStore';
import { I18nProvider } from '@lingui/react';
import { i18n } from '@/i18n';
import { useProjectStore } from '@/store/project';
import { CreateNewProjectDialogAnchor } from './dialogs/CreateNewProjectDialogStore';
import { DiscardProjectChangesDialog } from './dialogs/DiscardProjectChangesDialog';
import { ToastAnchor } from '@/store/toast';

type ProvidersProps = PropsWithChildren;

export function Providers({ children }: ProvidersProps) {
  const activeProject = useProjectStore((store) => store.activeProject);
  return (
    <I18nProvider i18n={i18n}>
      <ProjectScope project={activeProject}>
        {children}
        <CreateNewProjectDialogAnchor />
        <SelectRecordingDialogAnchor />
        <DiscardProjectChangesDialog />
        <ToastAnchor />
      </ProjectScope>
    </I18nProvider>
  );
}
