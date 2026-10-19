import { registerProjectWorkbenchCommands } from '@tensnap/web/project-commands';
import { useProjectStore } from '@tensnap/web';
import { WORKBENCH_COMMANDS, runWorkbenchCommand } from '@tensnap/web/commands';
import { useEffect } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useFileOperations } from '@tensnap/web/file-operations';
import { useSettingsStore } from '@tensnap/web/store';
import { setNativeMenuLocale, openDocumentation } from '../adapters/common';

export const useTauriMenuEvents = () => {
  const { onNewFile, onFileOpen, onRecordingOpen } = useFileOperations();

  const locale = useSettingsStore((x) => x.locale);

  useEffect(() => {
    void setNativeMenuLocale(locale).catch((error) => {
      console.error('Failed to update the native menu locale:', error);
    });
  }, [locale]);

  useEffect(() => {
    return registerProjectWorkbenchCommands({
      new: onNewFile,
      open: onFileOpen,
      'open-recording': onRecordingOpen,
      documentation: openDocumentation,
    });
  }, [onNewFile, onFileOpen, onRecordingOpen]);

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
