import * as styles from './styles/app.css';
import { ToolBarLayout } from './components/toolbar/ToolBarLayout';
import { MenuBarContext, type MenuBarConfig } from './components/toolbar/MenuBarContext';
import { useFileSystem } from './store/file-system/provider';
import { useLoadingStore } from './store/loading';
import { ProjectPanel } from './components/project/ProjectPanel';
import { SettingsDialog } from './dialogs/SettingsDialog';
import { useSettingsStore } from './store/settings';
import { useCallback, useEffect, useState } from 'react';


export function App(props: Partial<MenuBarConfig>) {
  
  const { loading: fileSystemLoading } = useFileSystem();
  const { loading: counterLoading } = useLoadingStore();
  
  const {
    environment = 'web',
    system = 'other',
    isFullscreen: controlledFullscreen,
    onExit,
    onToggleFullscreen,
  } = props;

  const [browserFullscreen, setBrowserFullscreen] = useState(() => (
    typeof document !== 'undefined' && Boolean(document.fullscreenElement)
  ));

  useEffect(() => {
    if (environment !== 'web') return;
    const syncFullscreen = () => setBrowserFullscreen(Boolean(document.fullscreenElement));
    syncFullscreen();
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, [environment]);

  const toggleFullscreen = useCallback(async () => {
    if (onToggleFullscreen) {
      await onToggleFullscreen();
      return;
    }
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  }, [onToggleFullscreen]);

  const isFullscreen = environment === 'tauri'
    ? controlledFullscreen ?? false
    : browserFullscreen;

  const settingsDialogOpen = useSettingsStore((store) => store.settingsDialogOpen);
  const setSettingsDialogOpen = useSettingsStore((store) => store.setSettingsDialogOpen);

  return (
    <div className={styles.appContainer}>
      <MenuBarContext.Provider value={{ environment, system, isFullscreen, onExit, onToggleFullscreen: toggleFullscreen }}>
        <ToolBarLayout />
      </MenuBarContext.Provider>

      <ProjectPanel />

      <SettingsDialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen} />

      {/* Loading Spinner Overlay */}
      {(fileSystemLoading || counterLoading) && (
        <div className={styles.spinnerOverlay}>
          <div className={styles.spinner} />
        </div>
      )}
    </div>
  );
}
