import { afterEach, expect, it, vi } from 'vitest';
import { Scenario } from '@tensnap/core';
import { createSingleSnapshot } from '@tensnap/core/snapshot';
import { ContentCodec, contentOwner } from './native-content';
import { useProjectStore } from '../store/project';

const wire = (value: unknown) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function bridge() {
  const owner = new ContentCodec();
  const child = new ContentCodec({
    call: async (method, args) => wire(await owner.invoke(method, wire(args))),
  });
  return {
    owner,
    child,
    dispose: () => {
      child.dispose();
      owner.dispose();
    },
  };
}
afterEach(() => {
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
it('round trips binary fields and tagged user data through JSON IPC and keeps callback identity', async () => {
  const link = bridge();
  try {
    const callback = vi.fn(async (bytes: Uint8Array) => new Map([['answer', bytes]]));
    const data = {
      callback,
      bytes: Uint8Array.of(0, 128, 255),
      map: new Map([['key', new Set([1, 2])]]),
      custom: { $content: 'bytes', data: [4] },
    };
    const decoded = link.child.decode(wire(link.owner.encode(data)));
    expect(decoded.bytes).toEqual(data.bytes);
    expect(decoded.map).toEqual(data.map);
    expect(decoded.custom).toEqual(data.custom);
    expect(await decoded.callback(Uint8Array.of(7))).toEqual(
      new Map([['answer', Uint8Array.of(7)]]),
    );
    expect(callback).toHaveBeenCalledWith(Uint8Array.of(7));
    expect(link.child.decode(wire(link.owner.encode(data))).callback).toBe(decoded.callback);
    expect(() => link.child.decode({ $content: 'unknown' })).toThrow('Unknown content encoding');
    expect(() => link.owner.encode(new Date())).toThrow('Unsupported content service');
  } finally {
    link.dispose();
  }
});
it('propagates callback cancellation and releases signal listeners on completion and disposal', async () => {
  const link = bridge();
  try {
    const signals: AbortSignal[] = [];
    const remote = link.child.decode(
      wire(
        link.owner.encode({
          read: (_request: unknown, signal: AbortSignal) => {
            signals.push(signal);
            return new Promise((_resolve, reject) =>
              signal.addEventListener(
                'abort',
                () => reject(new DOMException('Cancelled', 'AbortError')),
                { once: true },
              ),
            );
          },
        }),
      ),
    );
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = remote.read({}, controller.signal);
    expect(signals).toHaveLength(1);
    const rejected = expect(pending).rejects.toThrow('Cancelled');
    controller.abort();
    await rejected;
    expect(signals[0].aborted).toBe(true);
    expect(remove).toHaveBeenCalledTimes(1);
    const second = remote.read({}, new AbortController().signal);
    const closed = expect(second).rejects.toThrow('Cancelled');
    link.owner.dispose();
    await closed;
  } finally {
    link.dispose();
  }
});
it('preserves the original project for mutations after a different tab becomes active', async () => {
  useProjectStore
    .getState()
    .openOfflineSnapshot(createSingleSnapshot(new Scenario().dump(), { id: 'a' }));
  const original = useProjectStore.getState().activeProject!;
  const owner = contentOwner('SettingsDialog', { open: true, onOpenChange: vi.fn() });
  const child = new ContentCodec({ call: (method, args) => owner.codec.invoke(method, args) });
  try {
    const state = owner.state();
    const actions = child.decode(wire(state.project!.actions));
    useProjectStore
      .getState()
      .openOfflineSnapshot(createSingleSnapshot(new Scenario().dump(), { id: 'b' }));
    const other = useProjectStore.getState().activeProject!;
    await actions.renameSnapshot('a', 'original edited');
    expect(original.useScenarioStore.getState().snapshots[0].metadata.label).toBe(
      'original edited',
    );
    expect(other.useScenarioStore.getState().snapshots[0].metadata.label).not.toBe(
      'original edited',
    );
    expect(owner.update({ open: true, title: 'other tab' })).toBe(false);
    useProjectStore.setState({ projects: [other], activeProject: other });
    expect(() => owner.state()).toThrow('owner project has been closed');
  } finally {
    child.dispose();
    owner.dispose();
    original.useScenarioStore.getState().session.destroy();
  }
});
it('keeps native inspector initialization free of full-scene serialization', async () => {
  const scenario = new Scenario();
  scenario.apply({ type: 'env_create', payload: { id: 'world', type: '2d' } });
  scenario.apply({
    type: 'env_layer_create',
    payload: {
      env_id: 'world',
      layer_id: 'agents',
      layer_type: 'agent',
      metadata: { coord_offset: 'float' },
    },
  });
  scenario.apply({
    type: 'item_create',
    payload: { env_id: 'world', layer_id: 'agents', items: [{ id: 1, x: 0, y: 0 }] },
  });
  const dump = vi.spyOn(scenario, 'dump').mockImplementation(() => {
    throw new Error('Full dump forbidden');
  });
  const owner = contentOwner('AgentDetailsDialog', {
    scenario,
    agentRef: { environmentId: 'world', layerId: 'agents', agentId: 1 },
    open: true,
  });
  try {
    const state = wire(owner.state());
    expect(state.project).toBeUndefined();
    const child = new ContentCodec({
      call: async (method, args) => wire(await owner.codec.invoke(method, wire(args))),
    });
    const props = child.decode(state.props);
    expect(props.scenario).toBeUndefined();
    expect(
      await props.inspectionSource.read({ radius: 3, assets: {} }, new AbortController().signal),
    ).toMatchObject({
      view: { inspection: { agent: { id: 1 } }, scene: { environments: [{ id: 'world' }] } },
    });
    expect(dump).not.toHaveBeenCalled();
    child.dispose();
  } finally {
    owner.dispose();
  }
});

it('retargets an existing native inspector without changing its owner or serializing the full scene', async () => {
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
      items: [
        { id: 1, x: 0, y: 0 },
        { id: 2, x: 20, y: 30 },
      ],
    },
  });
  const dump = vi.spyOn(scenario, 'dump').mockImplementation(() => {
    throw new Error('Full dump forbidden');
  });
  const initial = {
    scenario,
    open: true,
    agentRef: { environmentId: 'world', layerId: 'agents', agentId: 1 },
  };
  const owner = contentOwner('AgentDetailsDialog', initial);
  const child = new ContentCodec({
    call: async (method, args) => wire(await owner.codec.invoke(method, wire(args))),
  });
  const signal = new AbortController().signal;
  try {
    const first = child.decode(wire(owner.state()).props);
    const response = await first.inspectionSource.read({ radius: 3, assets: {} }, signal);
    expect(response.view.inspection.agent.id).toBe(1);
    expect(owner.update({ ...initial, agentRef: { ...initial.agentRef, agentId: 2 } })).toBe(true);
    const state = wire(owner.state());
    expect(state.propsVersion).toBe(1);
    const next = child.decode(state.props);
    expect(
      await next.inspectionSource.read({ radius: 3, assets: {}, token: response.token }, signal),
    ).toMatchObject({ view: { inspection: { agent: { id: 2, x: 20, y: 30 } } } });
    expect(owner.update({ ...initial, agentRef: { ...initial.agentRef, agentId: 2 } })).toBe(false);
    expect(state.project).toBeUndefined();
    expect(dump).not.toHaveBeenCalled();
  } finally {
    child.dispose();
    owner.dispose();
  }
});
