import { useCallback } from 'react';
import { useFileSystem } from '@/store/file-system/provider';
import { useWithLoading } from '@/store/loading';
import { useProjectStore } from '@/store/project';
import { useCreateNewProjectStore } from '@/dialogs/CreateNewProjectDialog';

export interface FileOperationsContextValue {
  canSaveFile: boolean;
  onNewFile: () => void;
  onFileOpen: () => void;
  onFileSave: () => void;
  onFileSaveAs: () => void;
}

export const useFileOperations = (): FileOperationsContextValue => {
  const {
    openFile,
    saveFileAs,
  } = useFileSystem();

  const withLoading = useWithLoading();

  const activeTabId = useProjectStore((store) => store.activeProject?.id);
  const activeFilepath = useProjectStore((store) => store.activeFilepath);

  const createNewProject = useProjectStore((store) => store.new);
  const open = useProjectStore((store) => store.open);
  const save = useProjectStore((store) => store.save);

  const canSaveFile = activeTabId != null;
  const requiresSaveAs = !activeFilepath;

  const { invoke } = useCreateNewProjectStore();

  const onNewFile = useCallback(async () => {
    const url = await invoke();
    if (url) {
      createNewProject(url);
    }
  }, [invoke]);

  const onFileSave = useCallback(() => {
    withLoading(() => save(undefined));
  }, [withLoading, save]);

  const onFileOpen = useCallback(async () => {
    try {
      const file = await openFile('打开文件');
      if (file) {
        withLoading(() => open(file.path));
      }
    } catch (error) {
      console.error('Failed to open files:', error);
    }
  }, [withLoading, openFile, open]);

  const onFileSaveAs = useCallback(async () => {
    try {
      const file = await saveFileAs('另存为');
      if (file) {
        withLoading(() => save(undefined, file.path));
      }
    } catch (error) {
      console.error('Failed to save file:', error);
    }
  }, [withLoading, saveFileAs, save]);


  const contextValue: FileOperationsContextValue = {
    canSaveFile,
    onNewFile,
    onFileOpen,
    onFileSave: requiresSaveAs ? onFileSaveAs : onFileSave,
    onFileSaveAs,
  };

  return contextValue;
};
