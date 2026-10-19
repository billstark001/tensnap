import { act, render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { Scenario } from '@tensnap/core';
import { createSingleSnapshot } from '@tensnap/core/snapshot';
import { Providers } from '../Providers';
import { initI18n } from '../i18n';
import { AgentDetailsDialog } from '../dialogs/AgentDetailsDialog';
import { useProjectStore } from '../store/project';
import { useSettingsStore } from '../store/settings';
import { configureDialogHost } from '@tensnap/web-common/workbench/content';
import { createWinBoxHost } from '@tensnap/web-common/workbench/winbox-host';
const sdk = vi.hoisted(() => ({
  current: 'main',
  windows: [] as { label: string; destroy(): Promise<void> }[],
  listeners: new Map<
    string,
    Set<{ label: string; callback(event: { payload: unknown }): unknown }>
  >(),
  abortChild: undefined as (() => void) | undefined,
  packets: [] as unknown[],
}));
// Only the OS SDK and canvas are mocked; owner, protocol, receiver, stores and dialogs are real.
vi.mock('@tensnap/core/scenario/browser', () => ({
  EnvironmentRendererController: class {
    render = vi.fn();
    setViewport = vi.fn();
    destroy = vi.fn();
  },
}));
vi.mock('../../../tensnap-tauri/node_modules/@tauri-apps/api/event.js', () => ({
  listen: async (name: string, callback: (event: { payload: unknown }) => unknown) => {
    const entry = { label: sdk.current, callback };
    if (!sdk.listeners.has(name)) sdk.listeners.set(name, new Set());
    sdk.listeners.get(name)!.add(entry);
    return () => {
      sdk.listeners.get(name)?.delete(entry);
      if (!sdk.listeners.get(name)?.size) sdk.listeners.delete(name);
    };
  },
  emitTo: async (label: string, name: string, value: unknown) => {
    const payload = JSON.parse(JSON.stringify(value));
    sdk.packets.push(payload);
    for (const entry of sdk.listeners.get(name) ?? [])
      if (entry.label === label) await entry.callback({ payload });
  },
}));
vi.mock('../../../tensnap-tauri/node_modules/@tauri-apps/api/window.js', () => ({
  availableMonitors: async () => [],
  currentMonitor: async () => ({
    scaleFactor: 1,
    workArea: { position: { x: 0, y: 0 }, size: { width: 1440, height: 900 } },
  }),
}));
vi.mock('../../../tensnap-tauri/node_modules/@tauri-apps/api/webviewWindow.js', async () => {
  const events = await import('../../../tensnap-tauri/node_modules/@tauri-apps/api/event.js');
  return {
    WebviewWindow: class {
      destroy = vi.fn(async () => {
        sdk.abortChild?.();
      });
      once = vi.fn(async () => () => {});
      onMoved = vi.fn(async () => () => {});
      onResized = vi.fn(async () => () => {});
      scaleFactor = vi.fn(async () => 1);
      constructor(public label: string) {
        sdk.windows.push(this);
      }
    },
    getCurrentWebviewWindow: () => ({
      label: sdk.current,
      setTitle: async () => {},
      listen: events.listen,
      onCloseRequested: async () => () => {},
    }),
  };
});
import {
  installNativeWindows,
  startNativeContent,
} from '../../../tensnap-tauri/src/workbench/native-windows';

afterEach(() => {
  cleanup();
  configureDialogHost(createWinBoxHost());
  for (const project of useProjectStore.getState().projects)
    project.useScenarioStore.getState().session.destroy();
  useProjectStore.setState({ projects: [], tabs: [], activeIndex: null, activeProject: null });
  sdk.listeners.clear();
  sdk.windows.length = 0;
  sdk.packets.length = 0;
  sdk.current = 'main';
  sdk.abortChild = undefined;
});
it('opens a real native inspector, initializes across JSON IPC, retargets, and closes the entire owner scope', async () => {
  await initI18n('en');
  const scenario = new Scenario();
  scenario.apply({ type: 'env_create', payload: { id: 'world', type: 'uniform' } });
  scenario.apply({
    type: 'env_layer_create',
    payload: { env_id: 'world', layer_id: 'agents', layer_type: 'agent' },
  });
  scenario.apply({
    type: 'item_create',
    payload: {
      env_id: 'world',
      layer_id: 'agents',
      items: [
        { id: 'first', data: { name: 'First agent' } },
        { id: 'second', data: { name: 'Second agent' } },
      ],
    },
  });
  useProjectStore
    .getState()
    .openOfflineSnapshot(createSingleSnapshot(scenario.dump(), { id: 'source' }));
  const original = useProjectStore.getState().activeProject!;
  const source = original.useScenarioStore.getState().scenario;
  const before = useSettingsStore.getState();
  installNativeWindows();
  const closed = vi.fn();
  const view = (agentId: string, onClose = closed) => (
    <Providers>
      <AgentDetailsDialog
        open
        agent={null}
        scenario={source}
        agentType="uniform"
        agentRef={{ environmentId: 'world', layerId: 'agents', agentId }}
        onClose={onClose}
      />
    </Providers>
  );
  const main = render(view('first'));
  await waitFor(() => expect(sdk.windows).toHaveLength(1));
  const child = sdk.windows[0];
  sdk.current = child.label;
  const channel = child.label.slice('dialog-'.length);
  window.history.replaceState(
    null,
    '',
    `/?content=AgentDetailsDialog&owner=main&channel=${channel}`,
  );
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host),
    controller = new AbortController();
  sdk.abortChild = () => controller.abort();
  let stop: (() => void) | undefined;
  try {
    await act(async () => {
      stop = await startNativeContent(controller.signal, (node) => root.render(node));
    });
    await waitFor(() => expect(screen.getByText('First agent')).toBeTruthy());
    expect(useProjectStore.getState().activeProject).toBe(original);
    expect(useSettingsStore.getState()).toBe(before);
    sdk.current = 'main';
    act(() => main.rerender(view('second')));
    await waitFor(() => expect(screen.getByText('Second agent')).toBeTruthy());
    expect(screen.queryByText('First agent')).toBeNull();
    expect(sdk.windows).toHaveLength(1);
    expect(sdk.packets.some((packet) => (packet as { type?: string }).type === 'request')).toBe(
      true,
    );
    const unrelatedClose = vi.fn();
    act(() =>
      useProjectStore
        .getState()
        .openOfflineSnapshot(
          createSingleSnapshot(new Scenario().dump(), { id: 'another-project' }),
        ),
    );
    act(() => main.rerender(view('first', unrelatedClose)));
    expect(screen.getByText('Second agent')).toBeTruthy();
    fireEvent.keyDown(document.querySelector('[role=dialog]')!, { key: 'Escape' });
    await waitFor(() => expect(closed).toHaveBeenCalledTimes(1));
    expect(unrelatedClose).not.toHaveBeenCalled();
    await waitFor(() => expect(sdk.listeners.size).toBe(0));
    expect(screen.queryByRole('dialog')).toBeNull();
  } finally {
    await act(async () => {
      stop?.();
      root.unmount();
      main.unmount();
    });
    host.remove();
  }
});
