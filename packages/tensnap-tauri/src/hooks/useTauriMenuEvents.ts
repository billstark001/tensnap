import { useProjectStore } from '@tensnap/web';
import {
  WORKBENCH_COMMANDS,
  registerWorkbenchCommands,
  runWorkbenchCommand,
} from '@tensnap/web/commands';
import { saveProjectAs } from '@tensnap/web/file-operations';
import { useEffect } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useFileOperations } from '@tensnap/web/file-operations';
import { useSettingsStore } from '@tensnap/web/store';
import { setNativeMenuLocale, openDocumentation } from '../adapters/common';

export const useTauriMenuEvents = () => {
  const { onNewFile, onFileOpen, onRecordingOpen } = useFileOperations();

  const setSettingsDialogOpen = useSettingsStore((x) => x.setSettingsDialogOpen);
  const setAboutDialogOpen = useSettingsStore((x) => x.setAboutDialogOpen);
  const locale = useSettingsStore((x) => x.locale);

  useEffect(() => {
    void setNativeMenuLocale(locale).catch((error) => {
      console.error('Failed to update the native menu locale:', error);
    });
  }, [locale]);

  useEffect(() => {
    const project = (id: string | null) => {
      const store = useProjectStore.getState();
      const index = store.projects.findIndex((entry) => entry.id === id);
      if (index < 0) throw new Error('The owner project has been closed.');
      return { store, index, value: store.projects[index] };
    };
    return registerWorkbenchCommands({
      new: onNewFile,
      open: onFileOpen,
      'open-recording': onRecordingOpen,
      save: async (id) => {
        const target = project(id);
        if (target.value.filepath) await target.store.save(target.index);
        else await saveProjectAs(target.value.id);
      },
      'save-as': (id) => saveProjectAs(project(id).value.id),
      undo: (id) => project(id).value.useUndoRedoStore.getState().undo(),
      redo: (id) => project(id).value.useUndoRedoStore.getState().redo(),
      settings: () => setSettingsDialogOpen(true),
      about: () => setAboutDialogOpen(true),
      documentation: openDocumentation,
    });
  }, [onNewFile, onFileOpen, onRecordingOpen, setSettingsDialogOpen, setAboutDialogOpen]);

  useEffect(() => {
    const window = getCurrentWebviewWindow();
    let disposed = false;
    const stops: (() => void)[] = [];
    for (const command of WORKBENCH_COMMANDS) {
      void window
        .listen(`menu:${command}`, () => {
          void runWorkbenchCommand(
            command,
            useProjectStore.getState().activeProject?.id ?? null,
          ).catch((error) => console.error('Workbench command failed:', error));
        })
        .then((stop) => {
          if (disposed) stop();
          else stops.push(stop);
        })
        .catch((error) => console.error('Unable to register native menu listener:', error));
    }
    return () => {
      disposed = true;
      stops.splice(0).forEach((stop) => stop());
    };
  }, []);
};
