import { beforeEach, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  runtime: null as any,
  alive: true,
  changed: undefined as any,
  handlers: new Map<string, (event: any) => unknown>(),
  windows: [] as any[],
  stops: [] as ReturnType<typeof vi.fn>[],
  state: { contentId: 'AboutDialog', propsVersion: 0 },
  subscription: vi.fn(),
  disposeOwner: vi.fn(),
  menu: vi.fn(),
  invoke: vi.fn(),
  update: vi.fn(),
  disposeContent: vi.fn(),
  updateContent: vi.fn(),
  emit: vi.fn(),
  listen: vi.fn(),
}));
vi.mock('@tensnap/web-common/workbench/dialog-content', () => ({
  configureNativeDialogRuntime: (runtime: unknown) => {
    mock.runtime = runtime;
  },
}));
vi.mock('@tensnap/web', () => ({
  contentOwner: () => ({
    state: () => mock.state,
    isAlive: () => mock.alive,
    subscribe: (changed: unknown) => {
      mock.changed = changed;
      return mock.subscription;
    },
    dispose: mock.disposeOwner,
    codec: { invoke: mock.invoke },
    update: mock.update,
    menu: mock.menu,
  }),
  mountNativeContent: () => ({ dispose: mock.disposeContent, update: mock.updateContent }),
  registerWorkbenchCommands: () => vi.fn(),
}));
vi.mock('../../../tensnap-tauri/node_modules/@tauri-apps/api/event.js', () => ({
  listen: (...args: any[]) => mock.listen(...args),
  emitTo: (...args: any[]) => mock.emit(...args),
}));
vi.mock('../../../tensnap-tauri/node_modules/@tauri-apps/api/webviewWindow.js', () => {
  class WebviewWindow {
    label: string;
    destroy = vi.fn().mockResolvedValue(undefined);
    once = vi.fn().mockResolvedValue(vi.fn());
    setTitle = vi.fn().mockResolvedValue(undefined);
    listen = (...args: any[]) => mock.listen(...args);
    onCloseRequested = vi.fn(async () => vi.fn());
    constructor(
      label: string,
      public options: unknown,
    ) {
      this.label = label;
      mock.windows.push(this);
    }
  }
  return {
    WebviewWindow,
    getCurrentWebviewWindow: () => ({
      label: 'main',
      listen: (...args: any[]) => mock.listen(...args),
      onCloseRequested: async () => vi.fn(),
      setTitle: vi.fn().mockResolvedValue(undefined),
    }),
  };
});
import {
  installNativeWindows,
  startNativeContent,
} from '../../../tensnap-tauri/src/workbench/native-windows';
beforeEach(() => {
  vi.clearAllMocks();
  mock.alive = true;
  mock.handlers.clear();
  mock.windows.length = 0;
  mock.stops.length = 0;
  mock.listen.mockImplementation(async (name: string, callback: (event: any) => unknown) => {
    mock.handlers.set(name, callback);
    const stop = vi.fn(() => mock.handlers.delete(name));
    mock.stops.push(stop);
    return stop;
  });
  mock.emit.mockResolvedValue(undefined);
  window.history.replaceState(null, '', '/?content=AboutDialog&owner=main&channel=test');
});
it('registers the owner before creating a native child, dispatches RPC and disposes its scope', async () => {
  installNativeWindows();
  const close = vi.fn();
  const handle = mock.runtime.open('AboutDialog', { open: true }, close);
  expect(mock.windows).toHaveLength(0);
  await Promise.resolve();
  expect(mock.windows).toHaveLength(1);
  expect(mock.windows[0].options).toMatchObject({ parent: 'main' });
  const requestName = [...mock.handlers.keys()][0];
  await mock.handlers.get(requestName)!({
    payload: { id: 'init', method: 'initialize', args: [] },
  });
  expect(mock.emit).toHaveBeenCalledWith(
    mock.windows[0].label,
    requestName.replace('request', 'response'),
    { id: 'init', value: mock.state },
  );
  await mock.handlers.get(requestName)!({
    payload: { id: 'menu', method: 'menu', args: ['save'] },
  });
  expect(mock.menu).toHaveBeenCalledWith('save');
  handle.dispose();
  handle.dispose();
  expect(mock.subscription).toHaveBeenCalledTimes(1);
  expect(mock.disposeOwner).toHaveBeenCalledTimes(1);
  expect(mock.windows[0].destroy).toHaveBeenCalledTimes(1);
  expect(mock.handlers.size).toBe(0);
});
it('does not create an orphan child when disposed during listener registration', async () => {
  let finish!: (stop: () => void) => void;
  mock.listen.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  installNativeWindows();
  const handle = mock.runtime.open('AboutDialog', {}, vi.fn());
  handle.dispose();
  const stop = vi.fn();
  finish(stop);
  await Promise.resolve();
  expect(stop).toHaveBeenCalledTimes(1);
  expect(mock.windows).toHaveLength(0);
});
it('cleans every acquired listener when child initialization fails', async () => {
  mock.emit.mockImplementation(async (_owner: string, name: string, payload: any) => {
    if (name === 'content-request:test')
      await mock.handlers.get('content-response:test')!({
        payload: { id: payload.id, error: 'Owner closed' },
      });
  });
  await expect(
    startNativeContent(document.createElement('div'), new AbortController().signal),
  ).rejects.toThrow('Owner closed');
  expect(mock.handlers.size).toBe(0);
  expect(mock.stops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
});
it('aborts an in-flight initialization immediately and disposes a fully mounted child exactly once', async () => {
  const abort = new AbortController();
  const initializing = startNativeContent(document.createElement('div'), abort.signal);
  await Promise.resolve();
  await Promise.resolve();
  const rejection = expect(initializing).rejects.toThrow('closed');
  abort.abort();
  await rejection;
  expect(mock.handlers.size).toBe(0);
  mock.emit.mockImplementation(async (_owner: string, name: string, payload: any) => {
    if (name === 'content-request:test')
      await mock.handlers.get('content-response:test')!({
        payload: { id: payload.id, value: mock.state },
      });
  });
  const controller = new AbortController();
  const dispose = await startNativeContent(document.createElement('div'), controller.signal);
  controller.abort();
  dispose();
  expect(mock.disposeContent).toHaveBeenCalledTimes(1);
  expect(mock.handlers.size).toBe(0);
});

it('closes an owner scope before readiness when its project disappears', async () => {
  installNativeWindows();
  const close = vi.fn();
  const handle = mock.runtime.open('AboutDialog', {}, close);
  mock.alive = false;
  mock.changed();
  await Promise.resolve();
  expect(close).toHaveBeenCalledTimes(1);
  expect(mock.disposeOwner).toHaveBeenCalledTimes(1);
  expect(mock.windows).toHaveLength(0);
  handle.dispose();
});
