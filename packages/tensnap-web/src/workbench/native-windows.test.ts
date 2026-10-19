import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { encodeWindowData } from './auxiliary-protocol';
import { waitFor } from '@testing-library/react';
const mock = vi.hoisted(() => ({
  runtime: null as any,
  rpc: null as any,
  secondary: false,
  title: vi.fn().mockResolvedValue(undefined),
  alive: true,
  changed: undefined as any,
  handlers: new Map<string, (event: any) => unknown>(),
  windows: [] as any[],
  stops: [] as ReturnType<typeof vi.fn>[],
  state: {
    version: 1,
    revision: 0,
    projectId: null,
    appearance: { theme: 'light', locale: 'en' },
    content: { id: 'SimulatorInfoDialog', simulatorInfo: null, metadata: {} },
  },
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
vi.mock('@tensnap/web/auxiliary-owner', () => ({
  createAuxiliaryWindowOwner: () => ({
    state: () => mock.state,
    isAlive: () => mock.alive,
    subscribe: (changed: unknown) => {
      mock.changed = changed;
      return mock.subscription;
    },
    dispose: mock.disposeOwner,
    execute: mock.invoke,
    update: mock.update,
    menu: mock.menu,
  }),
}));
vi.mock('@tensnap/web/auxiliary-content', () => ({
  mountAuxiliaryWindow: (_state: unknown, rpc: unknown) => {
    mock.rpc = rpc;
    return { dispose: mock.disposeContent, update: mock.updateContent };
  },
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
    onMoved = vi.fn(async () => vi.fn());
    onResized = vi.fn(async () => vi.fn());
    scaleFactor = vi.fn(async () => 2);
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
      setTitle: mock.title,
    }),
  };
});
vi.mock('../../../tensnap-tauri/node_modules/@tauri-apps/api/window.js', () => ({
  availableMonitors: async () =>
    mock.secondary
      ? [
          {
            scaleFactor: 2,
            workArea: { position: { x: -1440, y: 0 }, size: { width: 1440, height: 1800 } },
          },
        ]
      : [],
  currentMonitor: async () => ({
    scaleFactor: 2,
    workArea: { position: { x: 0, y: 0 }, size: { width: 2880, height: 1800 } },
  }),
}));
import {
  installNativeWindows,
  startNativeContent,
} from '../../../tensnap-tauri/src/workbench/native-windows';
beforeEach(() => {
  vi.clearAllMocks();
  mock.alive = true;
  mock.secondary = false;
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
  mock.invoke.mockImplementation(async (command: { method: string }) =>
    command.method === 'initialize' ? mock.state : null,
  );
  window.history.replaceState(null, '', '/?content=SimulatorInfoDialog&owner=main&channel=test');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it('registers the owner before creating a native child, dispatches RPC and disposes its scope', async () => {
  installNativeWindows();
  const close = vi.fn();
  const handle = mock.runtime.open('SimulatorInfoDialog', { open: true }, close);
  expect(mock.windows).toHaveLength(0);
  await waitFor(() => expect(mock.windows).toHaveLength(1));
  expect(mock.windows[0].options).toMatchObject({ parent: 'main' });
  const requestName = [...mock.handlers.keys()][0];
  await mock.handlers.get(requestName)!({
    payload: { version: 1, type: 'request', id: 'init', command: { method: 'initialize' } },
  });
  expect(mock.emit).toHaveBeenCalledWith(
    mock.windows[0].label,
    requestName.replace('request', 'response'),
    { version: 1, id: 'init', value: encodeWindowData(mock.state) },
  );
  await mock.handlers.get(requestName)!({
    payload: {
      version: 1,
      type: 'request',
      id: 'menu',
      command: { method: 'menu', command: 'save' },
    },
  });
  expect(mock.invoke).toHaveBeenCalledWith(
    { method: 'menu', command: 'save' },
    expect.any(AbortSignal),
  );
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
  const handle = mock.runtime.open('SimulatorInfoDialog', {}, vi.fn());
  handle.dispose();
  const stop = vi.fn();
  finish(stop);
  await Promise.resolve();
  expect(stop).toHaveBeenCalledTimes(1);
  expect(mock.windows).toHaveLength(0);
});
it('cleans every acquired listener when child initialization fails', async () => {
  mock.emit.mockImplementation(async (_owner: string, name: string, payload: any) => {
    if (name === 'content-request:test' && payload.type === 'request')
      await mock.handlers.get('content-response:test')!({
        payload: { version: 1, id: payload.id, error: 'Owner closed' },
      });
  });
  await expect(startNativeContent(new AbortController().signal, vi.fn())).rejects.toThrow(
    'Owner closed',
  );
  expect(mock.handlers.size).toBe(0);
  expect(mock.stops.every((stop) => stop.mock.calls.length === 1)).toBe(true);
});
it('aborts an in-flight initialization immediately and disposes a fully mounted child exactly once', async () => {
  const abort = new AbortController();
  const initializing = startNativeContent(abort.signal, vi.fn());
  await Promise.resolve();
  await Promise.resolve();
  const rejection = expect(initializing).rejects.toThrow('closed');
  abort.abort();
  await rejection;
  expect(mock.handlers.size).toBe(0);
  mock.emit.mockImplementation(async (_owner: string, name: string, payload: any) => {
    if (name === 'content-request:test' && payload.type === 'request')
      await mock.handlers.get('content-response:test')!({
        payload: { version: 1, id: payload.id, value: encodeWindowData(mock.state) },
      });
  });
  const controller = new AbortController();
  const dispose = await startNativeContent(controller.signal, vi.fn());
  controller.abort();
  dispose();
  expect(mock.disposeContent).toHaveBeenCalledTimes(1);
  expect(mock.handlers.size).toBe(0);
});

it('closes an owner scope before readiness when its project disappears', async () => {
  installNativeWindows();
  const close = vi.fn();
  const handle = mock.runtime.open('SimulatorInfoDialog', {}, close);
  mock.alive = false;
  mock.changed();
  await Promise.resolve();
  expect(close).toHaveBeenCalledTimes(1);
  expect(mock.disposeOwner).toHaveBeenCalledTimes(1);
  expect(mock.windows).toHaveLength(0);
  handle.dispose();
});

it('gives native content a viewport shell and updates its single host title only when it changes', async () => {
  mock.emit.mockImplementation(async (_owner: string, name: string, payload: any) => {
    if (name === 'content-request:test' && payload.type === 'request')
      await mock.handlers.get('content-response:test')!({
        payload: { version: 1, id: payload.id, value: encodeWindowData(mock.state) },
      });
  });
  const dispose = await startNativeContent(new AbortController().signal, vi.fn());
  const { getDialogHost } = await import('@tensnap/web-common/workbench/content');
  const close = vi.fn();
  const options = {
    type: 'SimulatorInfoDialog',
    title: 'About',
    size: 'md' as const,
    modal: true,
    dismissible: true,
    onClose: close,
  };
  const shell = getDialogHost().create(options);
  try {
    expect(shell.element.classList.contains('native-content-window')).toBe(true);
    expect(shell.element.getAttribute('aria-label')).toBe('About');
    expect(mock.title).toHaveBeenCalledExactlyOnceWith('About');
    expect(shell.element.querySelector('h2, [data-dialog-close]')).toBeNull();
    shell.update({ ...options, title: 'Translated title' });
    expect(shell.element.getAttribute('aria-label')).toBe('Translated title');
    shell.update({ ...options, title: 'Translated title' });
    expect(mock.title).toHaveBeenCalledTimes(2);
    document.dispatchEvent(new Event('content-close-request'));
    expect(close).toHaveBeenCalledTimes(1);
    shell.update({ ...options, dismissible: false });
    document.dispatchEvent(new Event('content-close-request'));
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    shell.dispose();
    dispose();
  }
  expect(document.querySelector('.native-content-window')).toBeNull();
});

it('restores a remembered child onto a still-connected secondary display', async () => {
  const { configureSettingsPersistence, getSettingsPersistence } =
    await import('@tensnap/web-common/settings-persistence');
  const original = getSettingsPersistence();
  configureSettingsPersistence({
    get: async (key) =>
      key === 'window-placement:SimulatorInfoDialog'
        ? JSON.stringify({ generation: '', x: -600, y: 100, width: 480, height: 460 })
        : null,
    set: async () => {},
    remove: async () => {},
    keys: async () => [],
  });
  mock.secondary = true;
  installNativeWindows();
  const handle = mock.runtime.open('SimulatorInfoDialog', {}, vi.fn());
  try {
    await waitFor(() => expect(mock.windows).toHaveLength(1));
    expect(mock.windows[0].options).toMatchObject({ x: -600, y: 100, width: 480, height: 460 });
  } finally {
    handle.dispose();
    configureSettingsPersistence(original);
  }
});

it('rejects unknown commands and aborts in-flight owner work on cancellation', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  installNativeWindows();
  const handle = mock.runtime.open('SimulatorInfoDialog', {}, vi.fn());
  await waitFor(() => expect(mock.windows).toHaveLength(1));
  const receive = mock.handlers.values().next().value!;
  await receive({
    payload: { version: 1, type: 'request', id: 'bad', command: { method: 'setState' } },
  });
  expect(error).toHaveBeenCalled();
  expect(mock.invoke).not.toHaveBeenCalled();
  let inspectionSignal!: AbortSignal;
  mock.invoke.mockImplementationOnce(
    (_command: unknown, signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        inspectionSignal = signal;
        signal.addEventListener('abort', () => reject(new Error('Cancelled')), { once: true });
      }),
  );
  const work = receive({
    payload: {
      version: 1,
      type: 'request',
      id: 'read',
      command: { method: 'inspect', request: { radius: 1, assets: {} } },
    },
  });
  await receive({ payload: { version: 1, type: 'cancel', id: 'read' } });
  await work;
  expect(inspectionSignal.aborted).toBe(true);
  expect(mock.emit.mock.calls[mock.emit.mock.calls.length - 1]?.[2]).toMatchObject({
    id: 'read',
    error: 'Cancelled',
  });
  handle.dispose();
});

it('coalesces state changes while a prior state packet is still being delivered', async () => {
  installNativeWindows();
  const handle = mock.runtime.open('SimulatorInfoDialog', {}, vi.fn());
  await waitFor(() => expect(mock.windows).toHaveLength(1));
  await mock.handlers.values().next().value!({
    payload: { version: 1, type: 'request', id: 'init', command: { method: 'initialize' } },
  });
  vi.useFakeTimers();
  let finish!: () => void;
  mock.emit.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  mock.changed();
  await vi.advanceTimersByTimeAsync(100);
  mock.changed();
  mock.changed();
  await vi.advanceTimersByTimeAsync(1000);
  const statePackets = () =>
    mock.emit.mock.calls.filter((call) => call[1].startsWith('content-state:'));
  expect(statePackets()).toHaveLength(1);
  finish();
  await vi.advanceTimersByTimeAsync(100);
  expect(statePackets()).toHaveLength(2);
  handle.dispose();
  await vi.runAllTimersAsync();
  expect(statePackets()).toHaveLength(2);
});

it('cancels aborted and timed-out child requests and ignores malformed replies', async () => {
  mock.emit.mockImplementation(async (_owner: string, name: string, payload: any) => {
    if (
      name === 'content-request:test' &&
      payload.type === 'request' &&
      payload.command.method === 'initialize'
    )
      await mock.handlers.get('content-response:test')!({
        payload: { version: 1, id: payload.id, value: encodeWindowData(mock.state) },
      });
  });
  const dispose = await startNativeContent(new AbortController().signal, vi.fn());
  vi.useFakeTimers();
  const abort = new AbortController();
  const aborted = mock.rpc.request(
    { method: 'inspect', request: { radius: 1, assets: {} } },
    abort.signal,
  );
  const abortedResult = expect(aborted).rejects.toThrow('cancelled');
  abort.abort();
  await abortedResult;
  const timedOut = mock.rpc.request({ method: 'inspect', request: { radius: 1, assets: {} } });
  const timeoutResult = expect(timedOut).rejects.toThrow('did not respond');
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  await mock.handlers.get('content-response:test')!({ payload: null });
  expect(error).toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(10000);
  await timeoutResult;
  expect(mock.emit.mock.calls.filter((call) => call[2].type === 'cancel')).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(0);
  dispose();
  expect(mock.handlers.size).toBe(0);
});

it('releases the owner even when its close callback throws', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  installNativeWindows();
  mock.runtime.open('SimulatorInfoDialog', {}, () => {
    throw new Error('Unmount failed');
  });
  await waitFor(() => expect(mock.windows).toHaveLength(1));
  await mock.handlers.values().next().value!({ payload: { version: 1, type: 'close' } });
  expect(mock.disposeOwner).toHaveBeenCalledTimes(1);
  expect(mock.windows[0].destroy).toHaveBeenCalledTimes(1);
  expect(mock.handlers.size).toBe(0);
});
