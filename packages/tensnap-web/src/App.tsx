import { t } from '@lingui/core/macro';
import { createWorkbenchShell } from '@tensnap/web-common/workbench/layout';
import { ContentIsland } from '@tensnap/web-common/workbench/portal-content';
import { installBrowserFileDrop } from './workbench/file-drop';
import { useToast } from './store/toast';
import * as styles from './styles/app.css';
import { ToolBarLayout } from './components/toolbar/ToolBarLayout';
import { MenuBarContext, type MenuBarConfig } from './components/toolbar/MenuBarContext';
import { useFileSystem } from './store/file-system/provider';
import { useLoadingStore } from './store/loading';
import { ProjectPanel } from './components/project/ProjectPanel';
import { SettingsDialog } from './dialogs/SettingsDialog';
import { useSettingsStore } from './store/settings';
import { useCallback, useEffect, useState, useLayoutEffect } from 'react';

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

  const toast = useToast();
  useEffect(
    () =>
      environment === 'web'
        ? installBrowserFileDrop((errors) => {
            if (errors.length) toast.error(t`File import failed`, errors.join('\n'));
          })
        : undefined,
    [environment, toast],
  );

  const [browserFullscreen, setBrowserFullscreen] = useState(
    () => typeof document !== 'undefined' && Boolean(document.fullscreenElement),
  );

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

  const isFullscreen =
    environment === 'tauri' ? (controlledFullscreen ?? false) : browserFullscreen;

  const settingsDialogOpen = useSettingsStore((store) => store.settingsDialogOpen);
  const setSettingsDialogOpen = useSettingsStore((store) => store.setSettingsDialogOpen);

  const [shell] = useState(createWorkbenchShell);
  useLayoutEffect(() => {
    document.getElementById('root')!.append(shell.element);
    return () => shell.dispose();
  }, [shell]);
  useLayoutEffect(() => {
    shell.setTitlebarOverlay(environment === 'tauri' && system === 'mac' && !isFullscreen);
  }, [shell, environment, system, isFullscreen]);
  return (
    <>
      <MenuBarContext.Provider
        value={{ environment, system, isFullscreen, onExit, onToggleFullscreen: toggleFullscreen }}
      >
        <ContentIsland host={shell.toolbar}>
          <ToolBarLayout />
        </ContentIsland>
      </MenuBarContext.Provider>

      <ContentIsland host={shell.workspace}>
        <ProjectPanel />
      </ContentIsland>

      <SettingsDialog open={settingsDialogOpen} onOpenChange={setSettingsDialogOpen} />

      {/* Loading Spinner Overlay */}
      {(fileSystemLoading || counterLoading) && (
        <div className={styles.spinnerOverlay}>
          <div className={styles.spinner} />
        </div>
      )}
    </>
  );
}
