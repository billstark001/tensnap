import { useSelectRecordingStore } from '@/dialogs/SelectRecordingDialogStore';
import { useCallback } from 'react';
import { getFileSystemState, useFileSystem } from '@/store/file-system/provider';
import { useLoadingStore, useWithLoading } from '@/store/loading';
import { readRecordingSources, useProjectStore } from '@/store/project';
import { useSettingsStore } from '@/store/settings';
import { useCreateNewProjectStore } from '@/dialogs/CreateNewProjectDialogStore';
import { getToastState, useToast } from '@/store/toast';
import { t } from '@lingui/core/macro';

export interface FileOperationsContextValue {
  canSaveFile: boolean;
  onNewFile: () => void;
  onFileOpen: () => void;
  onRecordingOpen: () => void;
  onFileSave: () => void;
  onFileSaveAs: () => void;
}

export const useFileOperations = (): FileOperationsContextValue => {
  const { openFile } = useFileSystem();

  const withLoading = useWithLoading();
  const toast = useToast();

  const activeTabId = useProjectStore((store) => store.activeProject?.id);
  const activeFilepath = useProjectStore((store) => store.activeFilepath);

  const createNewProject = useProjectStore((store) => store.new);
  const open = useProjectStore((store) => store.open);
  const openRecordingStore = useProjectStore((store) => store.openRecordingStore);
  const openOfflineSnapshot = useProjectStore((store) => store.openOfflineSnapshot);
  const selectRecording = useSelectRecordingStore((store) => store.invoke);

  const canSaveFile = activeTabId != null;
  const requiresSaveAs = !activeFilepath;

  const { invoke } = useCreateNewProjectStore();

  const onNewFile = useCallback(async () => {
    const source = await invoke();
    if (source) {
      createNewProject(source);
    }
  }, [createNewProject, invoke]);

  const saveOwnedProject = useCallback(
    async (saveAs: boolean) => {
      if (!activeTabId) return;
      await saveProject(activeTabId, saveAs).catch(() => {});
    },
    [activeTabId],
  );
  const onFileSave = useCallback(() => saveOwnedProject(false), [saveOwnedProject]);

  const onFileOpen = useCallback(async () => {
    try {
      const file = await openFile(t`Open File`);
      if (file) {
        const result = await withLoading(() => open(file.path));
        if (result.recovered) {
          toast.warning(
            t`Project recovered with warnings`,
            t`Some data was invalid. Valid data was loaded; review the project and save a new copy.`,
          );
        }
      }
    } catch (error) {
      toast.error(t`Failed to open files`, String(error));
    }
  }, [withLoading, openFile, open, toast]);

  const onRecordingOpen = useCallback(async () => {
    try {
      const file = await openFile(t`Open recording`);
      if (!file) return;
      const { snapshots, layout, storeLink } = await withLoading(() =>
        readRecordingSources(file.path),
      );
      if (storeLink) {
        await withLoading(() => openRecordingStore(storeLink.owner, storeLink.recordingId));
        return;
      }
      if (!snapshots.length) throw new Error(t`The file contains no recordings.`);
      const id =
        snapshots.length === 1 ? snapshots[0].metadata.id : await selectRecording({ snapshots });
      const snapshot = snapshots.find((snapshot) => snapshot.metadata.id === id);
      if (snapshot) openOfflineSnapshot(snapshot, undefined, snapshot.initial.frame, layout);
    } catch (error) {
      toast.error(t`Failed to open recording`, String(error));
    }
  }, [openFile, withLoading, selectRecording, openOfflineSnapshot, openRecordingStore, toast]);

  const onFileSaveAs = useCallback(() => saveOwnedProject(true), [saveOwnedProject]);

  const contextValue: FileOperationsContextValue = {
    canSaveFile,
    onNewFile,
    onFileOpen,
    onRecordingOpen,
    onFileSave: requiresSaveAs ? onFileSaveAs : onFileSave,
    onFileSaveAs,
  };

  return contextValue;
};

/** One command path for rendered and native menus. Capture ID and format before the picker. */
export async function saveProject(projectId: string, saveAs = false): Promise<void> {
  const toast = getToastState();
  try {
    const path = await useLoadingStore
      .getState()
      .withLoading(() => saveProjectFile(projectId, saveAs));
    if (path) toast.success(t`File saved`, path);
  } catch (error) {
    toast.error(t`Failed to save file`, String(error));
    throw error;
  }
}

export async function saveProjectFile(
  projectId: string,
  saveAs = false,
): Promise<string | undefined> {
  const format = useSettingsStore.getState().saveFormat;
  const original = useProjectStore.getState().projects.find((project) => project.id === projectId);
  if (!original) throw new Error('The destination project was closed.');
  let path = original.filepath;
  if (saveAs || !path) {
    const file = await getFileSystemState().saveFileAs({
      title: t`Save As`,
      defaultPath: `project.${format}`,
      filters: [{ name: 'TenSnap project', extensions: [format] }],
    });
    if (!file) return;
    path = file.path;
  }
  const store = useProjectStore.getState();
  const index = store.projects.findIndex((project) => project.id === projectId);
  if (index < 0) throw new Error('The destination project was closed.');
  await store.save(index, path, format);
  return path;
}
