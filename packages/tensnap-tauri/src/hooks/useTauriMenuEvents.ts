import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useFileOperations } from '@tensnap/web/hooks';
import { useSettingsStore } from '@tensnap/web/store';
import { setNativeMenuLocale } from '../adapters/common';

export const useTauriMenuEvents = () => {
  const {
    onNewFile,
    onFileOpen,
    onFileSave,
    onFileSaveAs,
  } = useFileOperations();

  const setSettingsDialogOpen = useSettingsStore(x => x.setSettingsDialogOpen);
  const setAboutDialogOpen = useSettingsStore(x => x.setAboutDialogOpen);
  const locale = useSettingsStore(x => x.locale);

  useEffect(() => {
    void setNativeMenuLocale(locale).catch((error) => {
      console.error('Failed to update the native menu locale:', error);
    });
  }, [locale]);

  useEffect(() => {
    const unlistenPromises: Promise<() => void>[] = [];

    // File menu events
    unlistenPromises.push(listen('menu:new', () => onNewFile()));
    unlistenPromises.push(listen('menu:open', () => onFileOpen()));
    unlistenPromises.push(listen('menu:save', () => onFileSave()));
    unlistenPromises.push(listen('menu:save-as', () => onFileSaveAs()));

    // Edit menu events (placeholder for future implementation)
    unlistenPromises.push(listen('menu:undo', () => console.log('Undo')));
    unlistenPromises.push(listen('menu:redo', () => console.log('Redo')));
    unlistenPromises.push(listen('menu:cut', () => console.log('Cut')));
    unlistenPromises.push(listen('menu:copy', () => console.log('Copy')));
    unlistenPromises.push(listen('menu:paste', () => console.log('Paste')));
    unlistenPromises.push(listen('menu:select-all', () => console.log('Select All')));

    // View menu events (placeholder for future implementation)
    unlistenPromises.push(listen('menu:zoom-in', () => console.log('Zoom In')));
    unlistenPromises.push(listen('menu:zoom-out', () => console.log('Zoom Out')));
    unlistenPromises.push(listen('menu:reset-zoom', () => console.log('Reset Zoom')));
    unlistenPromises.push(listen('menu:show-grid', () => console.log('Show Grid')));
    unlistenPromises.push(listen('menu:show-toolbar', () => console.log('Show Toolbar')));

    // Tools menu events
    unlistenPromises.push(listen('menu:settings', () => setSettingsDialogOpen(true)));

    // Help menu events
    unlistenPromises.push(listen('menu:documentation', () => console.log('Documentation')));
    unlistenPromises.push(listen('menu:keyboard-shortcuts', () => console.log('Keyboard Shortcuts')));
    unlistenPromises.push(listen('menu:about', () => setAboutDialogOpen(true)));

    // Cleanup
    return () => {
      Promise.all(unlistenPromises).then(unlisteners => {
        unlisteners.forEach(unlisten => unlisten());
      });
    };
  }, [
    onNewFile,
    onFileOpen,
    onFileSave,
    onFileSaveAs,
    setSettingsDialogOpen,
    setAboutDialogOpen,
  ]);
};
