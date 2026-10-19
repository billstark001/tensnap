import { t } from '@lingui/core/macro';
import { createWorkbenchShell } from '@tensnap/web-common/workbench/layout';
import { createPortal } from 'react-dom';
import { installBrowserFileDrop } from './workbench/file-drop';
import { useToast } from './store/toast';
import * as styles from './styles/app.css';
import { ToolBarLayout } from './components/toolbar/ToolBarLayout';
import {
  MenuBarContext,
  openBrowserDocumentation,
  type MenuBarConfig,
} from './components/toolbar/MenuBarContext';
import { useFileSystem } from './store/file-system/provider';
import { useLoadingStore } from './store/loading';
import { ProjectPanel } from './components/project/ProjectPanel';
import { SettingsDialogAnchor } from './dialogs/SettingsDialogAnchor';
import { useCallback, useEffect, useState, useLayoutEffect } from 'react';

export function App(props: Partial<MenuBarConfig>) {
  const { loading: fileSystemLoading } = useFileSystem();
  const { loading: counterLoading } = useLoadingStore();

  const {
    environment = 'web',
    system = 'other',
    isFullscreen: controlledFullscreen,
    onOpenDocumentation = openBrowserDocumentation,
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
        value={{
          environment,
          system,
          isFullscreen,
          onExit,
          onOpenDocumentation,
          onToggleFullscreen: toggleFullscreen,
        }}
      >
        {createPortal(<ToolBarLayout />, shell.toolbar)}
      </MenuBarContext.Provider>

      {createPortal(<ProjectPanel />, shell.workspace)}

      <SettingsDialogAnchor />

      {/* Loading Spinner Overlay */}
      {(fileSystemLoading || counterLoading) && (
        <div className={styles.spinnerOverlay}>
          <div className={styles.spinner} />
        </div>
      )}
    </>
  );
}
