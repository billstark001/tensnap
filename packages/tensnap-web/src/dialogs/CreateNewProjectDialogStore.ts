import { createDialogStore } from '@/utils/zustand';
import { CreateNewProjectDialog } from './CreateNewProjectDialog';

export const [
  useCreateNewProjectStore,
  CreateNewProjectDialogAnchor,
] = createDialogStore(CreateNewProjectDialog, (res) => ({ onCreateItem: res }), '');