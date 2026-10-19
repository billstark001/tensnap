import { registerWorkbenchCommands, useProjectStore } from '@tensnap/web';
import { saveProjectAs } from '@tensnap/web/file-operations';
import { useEffect } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useFileOperations } from '@tensnap/web/file-operations';
import { useSettingsStore } from '@tensnap/web/store';
import { setNativeMenuLocale } from '../adapters/common';

const DOCUMENTATION_URL = 'https://github.com/billstark001/tensnap/tree/main/docs';

export const useTauriMenuEvents = () => {
  const { onNewFile, onFileOpen, onRecordingOpen, onFileSave, onFileSaveAs } = useFileOperations();

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
      documentation: () => window.open(DOCUMENTATION_URL, '_blank', 'noopener,noreferrer'),
    });
  }, [onNewFile, onFileOpen, onRecordingOpen, setSettingsDialogOpen, setAboutDialogOpen]);

  useEffect(() => {
    const listen = getCurrentWebviewWindow().listen.bind(getCurrentWebviewWindow());
    const unlistenPromises: Promise<() => void>[] = [];

    // File menu events
    unlistenPromises.push(listen('menu:new', () => onNewFile()));
    unlistenPromises.push(listen('menu:open', () => onFileOpen()));
    unlistenPromises.push(listen('menu:open-recording', () => onRecordingOpen()));
    unlistenPromises.push(listen('menu:save', () => onFileSave()));
    unlistenPromises.push(listen('menu:save-as', () => onFileSaveAs()));

    // Project edit commands; text editing uses native predefined menu items.
    unlistenPromises.push(
      listen('menu:undo', () => {
        void useProjectStore.getState().activeProject?.useUndoRedoStore.getState().undo();
      }),
    );
    unlistenPromises.push(
      listen('menu:redo', () => {
        void useProjectStore.getState().activeProject?.useUndoRedoStore.getState().redo();
      }),
    );

    // View menu events (placeholder for future implementation)
    unlistenPromises.push(listen('menu:zoom-in', () => console.log('Zoom In')));
    unlistenPromises.push(listen('menu:zoom-out', () => console.log('Zoom Out')));
    unlistenPromises.push(listen('menu:reset-zoom', () => console.log('Reset Zoom')));
    unlistenPromises.push(listen('menu:show-grid', () => console.log('Show Grid')));

    // Tools menu events
    unlistenPromises.push(listen('menu:settings', () => setSettingsDialogOpen(true)));

    // Help menu events
    unlistenPromises.push(
      listen('menu:documentation', () => {
        window.open(DOCUMENTATION_URL, '_blank', 'noopener,noreferrer');
      }),
    );
    unlistenPromises.push(
      listen('menu:keyboard-shortcuts', () => console.log('Keyboard Shortcuts')),
    );
    unlistenPromises.push(listen('menu:about', () => setAboutDialogOpen(true)));

    // Cleanup
    return () => {
      Promise.all(unlistenPromises).then((unlisteners) => {
        unlisteners.forEach((unlisten) => unlisten());
      });
    };
  }, [
    onNewFile,
    onFileOpen,
    onRecordingOpen,
    onFileSave,
    onFileSaveAs,
    setSettingsDialogOpen,
    setAboutDialogOpen,
  ]);
};
