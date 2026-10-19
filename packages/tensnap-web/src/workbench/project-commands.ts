import { useProjectStore } from '../store/project';
import { useSettingsStore } from '../store/settings';
import { saveProject } from '../components/toolbar/useFileOperations';
import { registerWorkbenchCommands } from './commands';

/** Host commands share project ownership rules with rendered controls. */
export function registerProjectWorkbenchCommands(files: {
  new: () => unknown;
  open: () => unknown;
  'open-recording': () => unknown;
  documentation: () => unknown;
}): () => void {
  const project = (id: string | null) => {
    const value = useProjectStore.getState().projects.find((entry) => entry.id === id);
    if (!value) throw new Error('The owner project has been closed.');
    return value;
  };
  return registerWorkbenchCommands({
    ...files,
    save: (id) => saveProject(project(id).id),
    'save-as': (id) => saveProject(project(id).id, true),
    undo: (id) => project(id).useUndoRedoStore.getState().undo(),
    redo: (id) => project(id).useUndoRedoStore.getState().redo(),
    settings: (id) => {
      if (id !== null) project(id);
      useSettingsStore.getState().setSettingsDialogOpen(true, id);
    },
    about: () => useSettingsStore.getState().setAboutDialogOpen(true),
  });
}
