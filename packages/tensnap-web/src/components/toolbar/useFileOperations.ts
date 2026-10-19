import { useSelectRecordingStore } from '@/dialogs/SelectRecordingDialogStore';
import { useCallback } from 'react';
import { getFileSystemState, useFileSystem } from '@/store/file-system/provider';
import { useWithLoading } from '@/store/loading';
import { readRecordingSources, useProjectStore } from '@/store/project';
import { useSettingsStore } from '@/store/settings';
import { useCreateNewProjectStore } from '@/dialogs/CreateNewProjectDialogStore';
import { useToast } from '@/store/toast';
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
  const { openFile, saveFileAs } = useFileSystem();

  const withLoading = useWithLoading();
  const toast = useToast();

  const activeTabId = useProjectStore((store) => store.activeProject?.id);
  const activeFilepath = useProjectStore((store) => store.activeFilepath);
  const saveFormat = useSettingsStore((store) => store.saveFormat);

  const createNewProject = useProjectStore((store) => store.new);
  const open = useProjectStore((store) => store.open);
  const openRecordingStore = useProjectStore((store) => store.openRecordingStore);
  const openOfflineSnapshot = useProjectStore((store) => store.openOfflineSnapshot);
  const selectRecording = useSelectRecordingStore((store) => store.invoke);
  const save = useProjectStore((store) => store.save);

  const canSaveFile = activeTabId != null;
  const requiresSaveAs = !activeFilepath;

  const { invoke } = useCreateNewProjectStore();

  const onNewFile = useCallback(async () => {
    const source = await invoke();
    if (source) {
      createNewProject(source);
    }
  }, [createNewProject, invoke]);

  const onFileSave = useCallback(async () => {
    try {
      await withLoading(() => save(undefined));
      toast.success(t`File saved`, activeFilepath ?? t`Project saved successfully.`);
    } catch (error) {
      toast.error(t`Failed to save file`, String(error));
    }
  }, [withLoading, save, toast, activeFilepath]);

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

  const onFileSaveAs = useCallback(async () => {
    try {
      const extension = saveFormat === 'msgpack' ? 'msgpack' : 'json';
      const file = await saveFileAs({
        title: t`Save As`,
        defaultPath: `project.${extension}`,
        filters: [
          {
            name: saveFormat === 'msgpack' ? 'TenSnap MessagePack project' : 'TenSnap JSON project',
            extensions: [extension],
          },
        ],
      });
      if (file) {
        await withLoading(() => save(undefined, file.path));
        toast.success(t`File saved`, file.path);
      }
    } catch (error) {
      toast.error(t`Failed to save file`, String(error));
    }
  }, [withLoading, saveFileAs, save, saveFormat, toast]);

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

/** Resolve the original tab after the save dialog, even if another tab was selected. */
export async function saveProjectAs(projectId: string): Promise<void> {
  const format = useSettingsStore.getState().saveFormat;
  const file = await getFileSystemState().saveFileAs({
    title: t`Save As`,
    defaultPath: `project.${format}`,
    filters: [{ name: 'TenSnap project', extensions: [format] }],
  });
  if (!file) return;
  const store = useProjectStore.getState();
  const index = store.projects.findIndex((project) => project.id === projectId);
  if (index < 0) throw new Error('The destination project was closed.');
  await store.save(index, file.path);
}
