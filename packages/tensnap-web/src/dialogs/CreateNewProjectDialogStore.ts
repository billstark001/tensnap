import { createDialogStore } from '@/utils/zustand';
import { CreateNewProjectDialog, type CreateNewDialogProps } from './CreateNewProjectDialog';
import type { ProjectSource } from '@tensnap/core/snapshot';

export const [
  useCreateNewProjectStore,
  CreateNewProjectDialogAnchor,
] = createDialogStore<CreateNewDialogProps, ProjectSource | null>(CreateNewProjectDialog, (res) => ({ onCreateItem: res }), null);
