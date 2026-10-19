import type { ReactNode } from 'react';
import { availableMonitors, currentMonitor } from '@tauri-apps/api/window';
import { configureDialogHost } from '@tensnap/web-common/workbench/content';
import {
  readWindowPlacement,
  saveWindowPlacement,
  windowGeometry,
} from '@tensnap/web-common/workbench/window-state';
import { WebviewWindow, getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen, emitTo } from '@tauri-apps/api/event';
import { configureNativeDialogRuntime } from '@tensnap/web-common/workbench/dialog-content';
import {
  contentOwner,
  mountNativeContent,
  type ContentState,
  type WorkbenchCommand,
  registerWorkbenchCommands,
} from '@tensnap/web';
import type { NativeDialogRuntime } from '@tensnap/web-common/workbench/dialog-content';

interface Request {
  id: string;
  method: string;
  args: unknown[];
}
interface Response {
  id: string;
  value?: unknown;
  error?: string;
}

/** Each dialog has its own channel, callback scope and owner-project subscription. */
export function installNativeWindows(): void {
  const runtime: NativeDialogRuntime = {
    open(contentId, props, onClose) {
      const channel = crypto.randomUUID();
      const ownerLabel = getCurrentWebviewWindow().label;
      const label = ownerLabel.startsWith('dialog-')
        ? `${ownerLabel}-${channel}`
        : `dialog-${channel}`;
      const owner = contentOwner(contentId, props);
      let disposed = false;
      let ready = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let window: WebviewWindow | undefined;
      let stopRequests: (() => void) | undefined;
      const stopWindowEvents: (() => void)[] = [];
      const ownWindowEvent = (stop: () => void) => {
        if (disposed) stop();
        else stopWindowEvents.push(stop);
      };
      const publish = () => {
        if (disposed) return;
        if (!owner.isAlive()) {
          onClose();
          dispose();
          return;
        }
        if (!ready || timer) return;
        timer = setTimeout(() => {
          timer = undefined;
          try {
            void emitTo(label, `content-state:${channel}`, owner.state()).catch(() => {
              onClose();
              dispose();
            });
          } catch {
            onClose();
            dispose();
          }
        }, 100);
      };
      const stopSubscription = owner.subscribe(publish);
      const requestListener = listen<Request>(`content-request:${channel}`, async ({ payload }) => {
        if (disposed) return;
        const reply: Response = { id: payload.id };
        try {
          if (payload.method === 'initialize') {
            ready = true;
            reply.value = owner.state();
          } else if (payload.method === 'menu')
            reply.value = await owner.menu(payload.args[0] as WorkbenchCommand);
          else reply.value = await owner.codec.invoke(payload.method, payload.args);
        } catch (error) {
          reply.error = error instanceof Error ? error.message : String(error);
        }
        if (!disposed)
          await emitTo(label, `content-response:${channel}`, reply).catch((error) => {
            console.error('Content response failed:', error);
            onClose();
            dispose();
          });
      });
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        if (timer) clearTimeout(timer);
        stopSubscription();
        owner.dispose();
        stopRequests?.();
        stopWindowEvents.splice(0).forEach((stop) => stop());
        void window
          ?.destroy()
          .catch((error) => console.error('Unable to destroy content window:', error));
      };
      const failed = (error: unknown) => {
        if (disposed) return;
        console.error('Content window initialization failed:', error);
        onClose();
        dispose();
      };
      // Register the owner listener before the child can send its ready request.
      void requestListener
        .then(async (stop) => {
          if (disposed) {
            stop();
            return;
          }
          stopRequests = stop;
          const [memory, current, monitors] = await Promise.all([
            readWindowPlacement(contentId),
            currentMonitor(),
            availableMonitors(),
          ]);
          const saved = memory.placement;
          const monitor =
            (saved &&
              monitors.find((candidate) => {
                const { position, size } = candidate.workArea;
                const scale = candidate.scaleFactor;
                const x = saved.x + saved.width / 2;
                const y = saved.y + saved.height / 2;
                return (
                  x >= position.x / scale &&
                  x < (position.x + size.width) / scale &&
                  y >= position.y / scale &&
                  y < (position.y + size.height) / scale
                );
              })) ||
            current;
          if (!monitor) throw new Error('No display is available for the content window.');
          if (disposed) return;
          const workArea = monitor.workArea;
          const factor = monitor.scaleFactor;
          const area = {
            x: workArea.position.x / factor + 12,
            y: workArea.position.y / factor + 12,
            width: workArea.size.width / factor - 24,
            height: workArea.size.height / factor - 64,
          };
          const geometry = windowGeometry(contentId, area, memory.placement);
          window = new WebviewWindow(label, {
            url: `index.html?content=${encodeURIComponent(contentId)}&owner=${encodeURIComponent(ownerLabel)}&channel=${channel}`,
            title: 'TenSnap',
            width: geometry.width,
            height: geometry.height,
            minWidth: geometry.minWidth,
            minHeight: geometry.minHeight,
            maxWidth: geometry.maxWidth,
            maxHeight: geometry.maxHeight,
            x: geometry.x,
            y: geometry.y,
            parent: ownerLabel,
          });
          let placement = {
            x: geometry.x,
            y: geometry.y,
            width: geometry.width,
            height: geometry.height,
          };
          let placementTimer: ReturnType<typeof setTimeout> | undefined;
          const remember = () => {
            clearTimeout(placementTimer);
            placementTimer = setTimeout(() => {
              void saveWindowPlacement(contentId, memory.generation, placement);
            }, 150);
          };
          stopWindowEvents.push(() => {
            clearTimeout(placementTimer);
            void saveWindowPlacement(contentId, memory.generation, placement);
          });
          const logicalEvent = (apply: (scale: number) => void) => {
            if (disposed) return;
            void window!.scaleFactor().then(
              (scale) => {
                if (disposed) return;
                apply(scale);
                remember();
              },
              (error) => {
                if (!disposed) console.error('Window geometry update failed:', error);
              },
            );
          };
          void window
            .onMoved(({ payload }) => {
              logicalEvent((scale) => {
                placement = { ...placement, x: payload.x / scale, y: payload.y / scale };
              });
            })
            .then(ownWindowEvent, failed);
          void window
            .onResized(({ payload }) => {
              logicalEvent((scale) => {
                placement = {
                  ...placement,
                  width: payload.width / scale,
                  height: payload.height / scale,
                };
              });
            })
            .then(ownWindowEvent, failed);
          void window
            .once('tauri://error', (event) => {
              if (disposed) return;
              console.error('Content window creation failed:', event.payload);
              onClose();
              dispose();
            })
            .then(ownWindowEvent, failed);
          void window
            .once('tauri://destroyed', () => {
              if (!disposed) onClose();
              dispose();
            })
            .then(ownWindowEvent, failed);
        })
        .catch(failed);
      return {
        update(next) {
          if (owner.update(next)) publish();
        },
        dispose,
      };
    },
  };
  configureNativeDialogRuntime(runtime);
}

export async function startNativeContent(
  host: HTMLElement,
  signal: AbortSignal,
  render: (content: ReactNode) => void,
): Promise<() => void> {
  const params = new URLSearchParams(location.search);
  const channel = params.get('channel');
  const owner = params.get('owner');
  if (!channel || !owner || !params.get('content'))
    throw new Error('Invalid auxiliary window address.');
  const window = getCurrentWebviewWindow();
  const pending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let disposed = false;
  const stops: (() => void)[] = [];
  let content: ReturnType<typeof mountNativeContent> | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener('abort', dispose);
    stops
      .splice(0)
      .reverse()
      .forEach((stop) => stop());
    content?.dispose();
    pending.forEach((request) => {
      clearTimeout(request.timer);
      request.reject(new Error('The content window closed.'));
    });
    pending.clear();
  };
  const own = (stop: () => void) => {
    if (disposed) stop();
    else stops.push(stop);
  };
  signal.addEventListener('abort', dispose, { once: true });
  if (signal.aborted) dispose();
  const call = (method: string, args: unknown[]): Promise<any> =>
    new Promise((resolve, reject) => {
      if (disposed) {
        reject(new Error('The content window is closed.'));
        return;
      }
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('The owner window did not respond.'));
      }, 30_000);
      pending.set(id, { resolve, reject, timer });
      void emitTo(owner, `content-request:${channel}`, { id, method, args }).catch((error) => {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      });
    });
  try {
    own(
      await listen<Response>(`content-response:${channel}`, ({ payload }) => {
        const request = pending.get(payload.id);
        if (!request) return;
        clearTimeout(request.timer);
        pending.delete(payload.id);
        if (payload.error) request.reject(new Error(payload.error));
        else request.resolve(payload.value);
      }),
    );
    let newest: ContentState | undefined;
    own(
      await listen<ContentState>(`content-state:${channel}`, ({ payload }) => {
        newest = payload;
        content?.update(payload);
      }),
    );
    const initial = await call('initialize', []);
    signal.throwIfAborted();
    configureDialogHost({
      create(options) {
        const element = document.createElement('section');
        element.className = 'content-island native-content-window';
        element.tabIndex = -1;
        element.setAttribute('role', options.dismissible ? 'dialog' : 'alertdialog');
        document.body.append(element);
        let contentDisposed = false;
        let lastTitle: string | undefined;
        const update = (next: typeof options) => {
          if (contentDisposed) return;
          options = next;
          element.setAttribute('aria-label', next.title);
          if (lastTitle === next.title) return;
          lastTitle = next.title;
          void window
            .setTitle(next.title)
            .catch((error) => console.error('Content title update failed:', error));
        };
        update(options);
        const key = (event: KeyboardEvent) => {
          if (
            event.key === 'Escape' &&
            options.dismissible &&
            !document.querySelector('[data-workbench-menu]')
          )
            options.onClose();
        };
        const requestClose = () => {
          if (options.dismissible) options.onClose();
        };
        document.addEventListener('content-close-request', requestClose);
        element.addEventListener('keydown', key);
        return {
          element,
          update,
          dispose() {
            if (contentDisposed) return;
            contentDisposed = true;
            document.removeEventListener('content-close-request', requestClose);
            element.removeEventListener('keydown', key);
            element.remove();
          },
        };
      },
    });
    content = mountNativeContent(host, initial, { call }, render);
    if (newest) content.update(newest);
    const commands = [
      'new',
      'open',
      'open-recording',
      'save',
      'save-as',
      'undo',
      'redo',
      'settings',
      'about',
      'documentation',
    ] as const;
    own(
      registerWorkbenchCommands(
        Object.fromEntries(
          commands.map((command) => [command, () => call('menu', [command])]),
        ) as Record<WorkbenchCommand, () => Promise<unknown>>,
      ),
    );
    // Register sequentially so each acquired listener is owned even if a later registration fails.
    for (const command of commands)
      own(
        await window.listen(`menu:${command}`, () => {
          void call('menu', [command]).catch((error) =>
            console.error('Owner command failed:', error),
          );
        }),
      );
    own(
      await window.onCloseRequested((event) => {
        event.preventDefault();
        document.dispatchEvent(new Event('content-close-request'));
      }),
    );
    signal.throwIfAborted();
    return dispose;
  } catch (error) {
    dispose();
    throw error;
  }
}
