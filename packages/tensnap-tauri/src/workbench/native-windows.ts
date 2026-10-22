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
import { createAuxiliaryWindowOwner } from '@tensnap/web/auxiliary-owner';
import { mountAuxiliaryWindow } from '@tensnap/web/auxiliary-content';
import {
  AuxiliaryMessageSchema,
  AuxiliaryResponseSchema,
  AuxiliaryStateSchema,
  isAuxiliaryWindowId,
  encodeWindowData,
  decodeWindowData,
  type AuxiliaryCommand,
  type AuxiliaryMessage,
  type AuxiliaryState,
  type WindowData,
} from '@tensnap/web/auxiliary-protocol';
import { WORKBENCH_COMMANDS } from '@tensnap/web/commands';
import type { NativeDialogRuntime } from '@tensnap/web-common/workbench/dialog-content';

interface Response {
  version: 1;
  id: string;
  value?: WindowData;
  error?: string;
}

/** Only the main Webview owns native read-only tools and their request lifetimes. */
export function installNativeWindows(): void {
  const runtime: NativeDialogRuntime = {
    supports: isAuxiliaryWindowId,
    open(contentId, props, onClose, projectId) {
      if (!isAuxiliaryWindowId(contentId))
        throw new Error(`Unsupported auxiliary window: ${contentId}`);
      const channel = crypto.randomUUID();
      const ownerLabel = getCurrentWebviewWindow().label;
      if (ownerLabel !== 'main') throw new Error('Only the main window may own auxiliary tools.');
      const label = `dialog-${channel}`;
      const owner = createAuxiliaryWindowOwner(
        contentId,
        props as Parameters<typeof createAuxiliaryWindowOwner>[1],
        projectId,
      );
      const operations = new Map<string, AbortController>();
      let publishing = false;
      let dirty = false;
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
          closeOwner();
          return;
        }
        dirty = true;
        if (!ready || timer || publishing) return;
        timer = setTimeout(() => {
          timer = undefined;
          if (disposed) return;
          publishing = true;
          dirty = false;
          void Promise.resolve()
            .then(() => {
              return disposed
                ? undefined
                : emitTo(label, `content-state:${channel}`, encodeWindowData(owner.state()));
            })
            .catch(failed)
            .finally(() => {
              publishing = false;
              if (dirty && !disposed) publish();
            });
        }, 100);
      };
      const stopSubscription = owner.subscribe(publish);
      const requestListener = listen<unknown>(`content-request:${channel}`, async ({ payload }) => {
        if (disposed) return;
        const parsed = AuxiliaryMessageSchema.safeParse(payload);
        if (!parsed.success) {
          console.error('Invalid auxiliary window message:', parsed.error.message);
          return;
        }
        const message = parsed.data;
        if (message.type === 'close') {
          closeOwner();
          return;
        }
        if (message.type === 'cancel') {
          operations.get(message.id)?.abort();
          return;
        }
        const reply: Response = { version: 1, id: message.id };
        const operation = new AbortController();
        if (operations.size >= 32 || operations.has(message.id)) {
          reply.error = 'Too many auxiliary window requests.';
        } else {
          operations.set(message.id, operation);
          try {
            if (message.command.method === 'initialize') ready = true;
            const result = await owner.execute(message.command, operation.signal);
            operation.signal.throwIfAborted();
            reply.value = encodeWindowData(result);
          } catch (error) {
            reply.error = error instanceof Error ? error.message : String(error);
          } finally {
            operations.delete(message.id);
          }
        }
        if (!disposed) await emitTo(label, `content-response:${channel}`, reply).catch(failed);
      });
      const dispose = () => {
        if (disposed) return;
        disposed = true;
        if (timer) clearTimeout(timer);
        operations.forEach((operation) => operation.abort());
        operations.clear();
        stopSubscription();
        owner.dispose();
        stopRequests?.();
        stopWindowEvents.splice(0).forEach((stop) => stop());
        void window
          ?.destroy()
          .catch((error) => console.error('Unable to destroy content window:', error));
      };
      const closeOwner = () => {
        if (disposed) return;
        try {
          onClose();
        } catch (error) {
          console.error('Owner close callback failed:', error);
        } finally {
          dispose();
        }
      };
      const failed = (error: unknown) => {
        if (disposed) return;
        console.error('Content window initialization failed:', error);
        closeOwner();
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
              closeOwner();
            })
            .then(ownWindowEvent, failed);
          void window
            .once('tauri://destroyed', () => {
              closeOwner();
            })
            .then(ownWindowEvent, failed);
        })
        .catch(failed);
      return {
        update(next) {
          owner.update(next as Parameters<typeof owner.update>[0]);
        },
        dispose,
      };
    },
  };
  configureNativeDialogRuntime(runtime);
}

export async function startNativeContent(
  signal: AbortSignal,
  render: (content: ReactNode) => void,
): Promise<() => void> {
  const params = new URLSearchParams(location.search);
  const channel = params.get('channel');
  const owner = params.get('owner');
  const contentId = params.get('content');
  if (!channel || owner !== 'main' || !contentId || !isAuxiliaryWindowId(contentId))
    throw new Error('Invalid auxiliary window address.');
  const window = getCurrentWebviewWindow();
  const pending = new Map<
    string,
    { reject(error: Error): void; resolve(value: unknown): void; release(): void }
  >();
  let disposed = false;
  const stops: (() => void)[] = [];
  let content: ReturnType<typeof mountAuxiliaryWindow> | undefined;
  const notify = (message: AuxiliaryMessage) =>
    emitTo(owner, `content-request:${channel}`, message);
  const close = () => {
    if (!disposed) void notify({ version: 1, type: 'close' }).catch(console.error);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener('abort', dispose);
    content?.dispose();
    pending.forEach((request, id) => {
      void notify({ version: 1, type: 'cancel', id }).catch(() => {});
      request.release();
      request.reject(new Error('The content window closed.'));
    });
    pending.clear();
    stops
      .splice(0)
      .reverse()
      .forEach((stop) => stop());
  };
  const own = (stop: () => void) => {
    if (disposed) stop();
    else stops.push(stop);
  };
  signal.addEventListener('abort', dispose, { once: true });
  if (signal.aborted) dispose();
  const request = (command: AuxiliaryCommand, cancellation?: AbortSignal): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (disposed || cancellation?.aborted) {
        reject(new Error('The content request was cancelled or closed.'));
        return;
      }
      if (pending.size >= 32) {
        reject(new Error('Too many auxiliary window requests.'));
        return;
      }
      const id = crypto.randomUUID();
      const cancel = (reason: string) => {
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        entry.release();
        void notify({ version: 1, type: 'cancel', id }).catch(() => {});
        reject(new Error(reason));
      };
      const abort = () => cancel('The content request was cancelled.');
      const timer = setTimeout(
        () => cancel('The owner window did not respond.'),
        command.method === 'inspect' ? 10000 : 30000,
      );
      const release = () => {
        clearTimeout(timer);
        cancellation?.removeEventListener('abort', abort);
      };
      pending.set(id, { resolve, reject, release });
      cancellation?.addEventListener('abort', abort, { once: true });
      void notify({ version: 1, type: 'request', id, command }).catch((error) => {
        if (!pending.delete(id)) return;
        release();
        reject(error);
      });
    });
  try {
    own(
      await listen<unknown>(`content-response:${channel}`, ({ payload }) => {
        const parsed = AuxiliaryResponseSchema.safeParse(payload);
        if (!parsed.success) {
          console.error('Invalid auxiliary window response:', parsed.error.message);
          return;
        }
        const response = parsed.data;
        const entry = pending.get(response.id);
        if (!entry) return;
        pending.delete(response.id);
        entry.release();
        try {
          if ('error' in response) throw new Error(response.error);
          entry.resolve(decodeWindowData(response.value));
        } catch (error) {
          entry.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }),
    );
    let newest: AuxiliaryState | undefined;
    own(
      await listen<WindowData>(`content-state:${channel}`, ({ payload }) => {
        try {
          const state = AuxiliaryStateSchema.parse(decodeWindowData(payload));
          if (!newest || state.revision > newest.revision) newest = state;
          content?.update(state);
        } catch (error) {
          console.error('Invalid auxiliary window state:', error);
          close();
        }
      }),
    );
    const initial = AuxiliaryStateSchema.parse(await request({ method: 'initialize' }));
    if (initial.content.id !== contentId) throw new Error('Auxiliary content ID mismatch.');
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
            !event.defaultPrevented &&
            !(event.target instanceof Element && event.target.closest('[role="listbox"]')) &&
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
    content = mountAuxiliaryWindow(initial, { request, close }, render);
    if (newest) content.update(newest);
    for (const command of WORKBENCH_COMMANDS)
      own(
        await window.listen(`menu:${command}`, () => {
          void request({ method: 'menu', command }).catch((error) =>
            console.error('Owner command failed:', error),
          );
        }),
      );
    own(
      await window.onCloseRequested((event) => {
        event.preventDefault();
        close();
      }),
    );
    signal.throwIfAborted();
    return dispose;
  } catch (error) {
    if (!signal.aborted) close();
    dispose();
    throw error;
  }
}
