import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import * as ReactDOMClient from 'react-dom/client';
import { Scenario } from '@tensnap/core';
import { createSingleSnapshot } from '@tensnap/core/snapshot';
import { createAuxiliaryWindowOwner } from './auxiliary-owner';
import { mountAuxiliaryWindow } from './auxiliary-content';
import {
  AuxiliaryCommandSchema,
  AuxiliaryStateSchema,
  encodeWindowData,
  decodeWindowData,
} from './auxiliary-protocol';
import { useProjectStore } from '../store/project';
import { useSettingsStore } from '../store/settings';
import { registerWorkbenchCommands } from './commands';
vi.mock('@tensnap/core/scenario/browser', () => ({
  EnvironmentRendererController: class {
    render = vi.fn();
    setViewport = vi.fn();
    destroy = vi.fn();
  },
}));
const wire = (value: unknown) =>
  decodeWindowData(JSON.parse(JSON.stringify(encodeWindowData(value))));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const project of useProjectStore.getState().projects)
    project.useScenarioStore.getState().session.destroy();
  useProjectStore.setState({
    projects: [],
    tabs: [],
    activeIndex: null,
    activeProject: null,
    activeFilepath: null,
  });
});
function fixture(count = 2) {
  const scenario = new Scenario();
  scenario.apply({ type: 'env_create', payload: { id: 'world', type: '2d' } });
  scenario.apply({
    type: 'env_layer_create',
    payload: { env_id: 'world', layer_id: 'agents', layer_type: 'agent' },
  });
  scenario.apply({
    type: 'item_create',
    payload: {
      env_id: 'world',
      layer_id: 'agents',
      items: Array.from({ length: count }, (_, id) => ({ id, x: id * 20, y: 0 })),
    },
  });
  return scenario;
}
const target = { environmentId: 'world', layerId: 'agents', agentId: 0 };

it('rejects services, callbacks, DOM events and unregistered commands instead of pretending to proxy a store', () => {
  for (const value of [
    new Scenario(),
    new Date(),
    new MouseEvent('click'),
    { callback: () => {} },
    new Map(),
  ])
    expect(() => encodeWindowData(value)).toThrow('data only');
  for (const value of [
    { method: 'callback', args: [] },
    { method: 'menu', command: 'clearAll' },
    { method: 'inspect', request: { radius: -1, assets: {} } },
  ])
    expect(AuxiliaryCommandSchema.safeParse(value).success).toBe(false);
  const data = {
    bytes: Uint8Array.of(0, 128, 255),
    user: { bytes: [42], entries: [['key', 'value']] },
  };
  expect(wire(data)).toEqual(data);
  expect(() => decodeWindowData({ bytes: [256] })).toThrow();
});
it('keeps information packets independent of agent population, recording history and per-tick notifications', () => {
  const sizes: number[] = [];
  for (const count of [10, 100000]) {
    const scenario = fixture(count);
    const dump = vi.spyOn(scenario, 'dump').mockImplementation(() => {
      throw new Error('Full scene forbidden');
    });
    const owner = createAuxiliaryWindowOwner(
      'SimulatorInfoDialog',
      { scenario, open: true, onOpenChange: vi.fn(), simulatorInfo: null },
      null,
    );
    const changed = vi.fn();
    const stop = owner.subscribe(changed);
    try {
      const state = wire(owner.state());
      expect(AuxiliaryStateSchema.safeParse(state).success).toBe(true);
      sizes.push(JSON.stringify(state).length);
      scenario.apply({
        type: 'item_update',
        payload: { env_id: 'world', layer_id: 'agents', items: [{ id: 0, x: 2 }] },
      });
      expect(changed).not.toHaveBeenCalled();
      scenario.apply({ type: 'metadata_update', payload: { label: 'new metadata' } });
      expect(changed).toHaveBeenCalledTimes(1);
      expect(owner.state().content).toMatchObject({ metadata: { label: 'new metadata' } });
      expect(dump).not.toHaveBeenCalled();
    } finally {
      stop();
      owner.dispose();
    }
  }
  expect(sizes[0]).toBe(sizes[1]);
});
it('binds commands to the original project, validates cancellation and releases subscriptions', async () => {
  useProjectStore
    .getState()
    .openOfflineSnapshot(createSingleSnapshot(fixture().dump(), { id: 'a' }));
  const original = useProjectStore.getState().activeProject!;
  const scenario = original.useScenarioStore.getState().scenario;
  const owner = createAuxiliaryWindowOwner(
    'AgentDetailsDialog',
    { scenario, agentRef: target, agent: null, onClose: vi.fn(), open: true },
    original.id,
  );
  const changed = vi.fn();
  owner.subscribe(changed);
  const save = vi.fn();
  const handlers = {
    new: save,
    open: save,
    'open-recording': save,
    save,
    'save-as': save,
    undo: save,
    redo: save,
    settings: save,
    about: save,
    documentation: save,
  };
  const stop = registerWorkbenchCommands(handlers);
  try {
    useProjectStore
      .getState()
      .openOfflineSnapshot(createSingleSnapshot(fixture().dump(), { id: 'b' }));
    await owner.execute({ method: 'menu', command: 'save' }, new AbortController().signal);
    expect(save).toHaveBeenCalledWith(original.id);
    const abort = new AbortController();
    abort.abort();
    await expect(
      owner.execute({ method: 'inspect', request: { radius: 3, assets: {} } }, abort.signal),
    ).rejects.toThrow();
    expect(owner.update({ scenario: fixture(), agent: null, onClose: vi.fn() })).toBe(false);
    owner.dispose();
    owner.dispose();
    changed.mockClear();
    useSettingsStore.getState().toggleTheme();
    expect(changed).not.toHaveBeenCalled();
    await expect(
      owner.execute({ method: 'initialize' }, new AbortController().signal),
    ).rejects.toThrow('closed');
  } finally {
    stop();
    owner.dispose();
  }
});
it('mounts real inspector content through JSON IPC in the caller root, retargets and releases all image URLs', async () => {
  const create = vi.fn(() => `blob:asset-${Math.random()}`),
    revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const scenario = fixture();
  await scenario.assets.receiveData('icon', 'hash', 'image/png', Uint8Array.of(1, 2, 3));
  scenario.apply({
    type: 'item_update',
    payload: { env_id: 'world', layer_id: 'agents', items: [{ id: 0, icon: 'asset:icon' }] },
  });
  const props = { scenario, agentRef: target, agent: null, onClose: vi.fn(), open: true };
  const owner = createAuxiliaryWindowOwner('AgentDetailsDialog', props, null);
  const rootElement = document.createElement('div');
  document.body.append(rootElement);
  const root = ReactDOMClient.createRoot(rootElement);
  const close = vi.fn();
  const commands: string[] = [];
  let content!: ReturnType<typeof mountAuxiliaryWindow>;
  try {
    await act(async () => {
      content = mountAuxiliaryWindow(
        wire(owner.state()) as ReturnType<typeof owner.state>,
        {
          close,
          request: async (command, signal) => {
            commands.push(command.method);
            return wire(
              await owner.execute(
                JSON.parse(JSON.stringify(command)),
                signal ?? new AbortController().signal,
              ),
            );
          },
        },
        (node) => root.render(node),
      );
    });
    await waitFor(() => expect(screen.getByText('Agent Details')).toBeTruthy());
    expect(commands).toContain('inspect');
    const first = owner.state();
    owner.update({ ...props, agentRef: { ...target, agentId: 1 } });
    await act(async () => content.update(wire(owner.state()) as typeof first));
    await waitFor(() =>
      expect(commands.filter((command) => command === 'inspect').length).toBeGreaterThan(1),
    );
    await act(async () => content.update(first)); // Old packets cannot switch target back.
    fireEvent.keyDown(document.querySelector('[role=dialog]')!, { key: 'Escape' });
    expect(close).toHaveBeenCalledTimes(1);
    await act(async () => content.dispose());
    scenario.assets.destroy();
    expect(revoke.mock.calls.length).toBe(create.mock.calls.length);
    expect(screen.queryByRole('dialog')).toBeNull();
  } finally {
    act(() => root.unmount());
    owner.dispose();
    scenario.assets.destroy();
    rootElement.remove();
    vi.unstubAllGlobals();
  }
});

it('deduplicates real session getter clones and observes owned identity changes and reset', () => {
  useProjectStore.getState().openOfflineSnapshot(createSingleSnapshot(fixture().dump()));
  const project = useProjectStore.getState().activeProject!;
  const { session, scenario } = project.useScenarioStore.getState();
  const info = {
    protocol_version: '0.3' as const,
    binding: { name: 'test', version: '1' },
    model: { id: 'test' },
    instance_id: 'instance',
    capabilities: [],
  };
  session.handleIncoming({ type: 'simulator_info', payload: info });
  const props = {
    scenario,
    simulatorInfo: session.simulatorInfo,
    open: true,
    onOpenChange: vi.fn(),
  };
  const owned = createAuxiliaryWindowOwner('SimulatorInfoDialog', props, project.id);
  const fallback = createAuxiliaryWindowOwner('SimulatorInfoDialog', props, null);
  const ownedChanged = vi.fn(),
    fallbackChanged = vi.fn();
  owned.subscribe(ownedChanged);
  fallback.subscribe(fallbackChanged);
  try {
    for (let index = 0; index < 20; index++) {
      owned.update({ ...props, simulatorInfo: session.simulatorInfo });
      fallback.update({ ...props, simulatorInfo: session.simulatorInfo });
    }
    expect(ownedChanged).not.toHaveBeenCalled();
    expect(fallbackChanged).not.toHaveBeenCalled();
    session.handleIncoming({
      type: 'simulator_info',
      payload: { ...info, model: { id: 'changed' } },
    });
    expect(ownedChanged).toHaveBeenCalledOnce();
    owned.update({ ...props, simulatorInfo: session.simulatorInfo });
    expect(ownedChanged).toHaveBeenCalledOnce();
    fallback.update({ ...props, simulatorInfo: session.simulatorInfo });
    expect(fallbackChanged).toHaveBeenCalledOnce();
    session.resetSimulatorIdentity();
    expect(ownedChanged).toHaveBeenCalledTimes(2);
    expect(owned.state().content).toMatchObject({ simulatorInfo: null });
    scenario.load({ ...scenario.dump(), metadata: { label: 'loaded' } });
    expect(ownedChanged).toHaveBeenCalledTimes(3);
    expect(owned.state().content).toMatchObject({ metadata: { label: 'loaded' } });
    scenario.reset();
    expect(ownedChanged).toHaveBeenCalledTimes(4);
    expect(owned.state().content).toMatchObject({ metadata: {} });
  } finally {
    owned.dispose();
    fallback.dispose();
  }
});
