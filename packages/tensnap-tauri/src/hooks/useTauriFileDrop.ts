import { t } from '@lingui/core/macro';
import { useEffect } from 'react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  fileDropTargetAt,
  importDroppedFiles,
  highlightFileDrop,
  clearFileDropHighlight,
} from '@tensnap/web';
import { getFileSystemState, useToast } from '@tensnap/web/store';
export function useTauriFileDrop() {
  const toast = useToast();
  useEffect(() => {
    let disposed = false;
    const window = getCurrentWindow();
    let scale = 1;
    const stops: (() => void)[] = [];
    const own = (stop: () => void) => {
      if (disposed) stop();
      else stops.push(stop);
    };
    const initialize = async () => {
      scale = await window.scaleFactor();
      own(
        await window.onScaleChanged((event) => {
          scale = event.payload.scaleFactor;
        }),
      );
      if (disposed) return;
      own(
        await getCurrentWebview().onDragDropEvent((event) => {
          if (disposed) return;
          if (event.payload.type === 'leave') {
            clearFileDropHighlight();
            return;
          }
          const { x, y } = event.payload.position.toLogical(scale);
          highlightFileDrop(x, y);
          if (event.payload.type !== 'drop') return;
          const target = fileDropTargetAt(x, y);
          clearFileDropHighlight();
          void importDroppedFiles(
            event.payload.paths.map((path) => ({
              path,
              name: path.replace(/\\/g, '/').split('/').pop()!,
              read: async () => {
                const file = await getFileSystemState().readFile(path);
                if (!file) throw new Error(`Unable to read ${path}`);
                return typeof file.content === 'string'
                  ? new TextEncoder().encode(file.content)
                  : new Uint8Array(file.content);
              },
            })),
            target,
          ).then((errors) => {
            if (errors.length) toast.error(t`File import failed`, errors.join('\n'));
          });
        }),
      );
    };
    void initialize().catch((error) => {
      stops.splice(0).forEach((stop) => stop());
      if (!disposed) toast.error(t`File drop initialization failed`, String(error));
    });
    return () => {
      disposed = true;
      clearFileDropHighlight();
      stops.splice(0).forEach((stop) => stop());
    };
  }, [toast]);
}
