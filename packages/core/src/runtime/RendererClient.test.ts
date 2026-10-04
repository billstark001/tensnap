import { describe, expect, it, vi } from 'vitest';
import type { RendererToSimulatorMessage, SimulatorToRendererMessage } from '@tensnap/protocol';
import type { ISimulatorTransport, TransportEventMap } from '../transport';
import { RendererClient } from './RendererClient';
import { RendererSession } from './RendererSession';

type TestTransport = ISimulatorTransport & { emitMessage(message: SimulatorToRendererMessage): void };

function synchronousTransport(modelId = 'model'): TestTransport {
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const emit = (type: string, value: unknown): void => {
    for (const listener of listeners.get(type) ?? []) listener(value);
  };
  return {
    connectionId: 'sync-test', transportKind: 'inmemory', encoding: 'json',
    connectionState: 'open', isConnected: true,
    connect: async () => {
      emit('message', { type: 'simulator_info', payload: {
        protocol_version: '0.3', binding: { name: 'test', version: '1' },
        model: { id: modelId }, instance_id: 'instance', capabilities: [],
      } } satisfies SimulatorToRendererMessage);
    },
    disconnect: () => {}, destroy: () => {},
    send: (message: RendererToSimulatorMessage) => {
      if (message.type !== 'state_sync') return;
      const requestId = (message.payload as { request_id: string }).request_id;
      emit('message', { type: 'state_sync_begin', payload: {
        request_id: requestId, model_id: modelId, instance_id: 'instance', mode: 'replace',
      } } satisfies SimulatorToRendererMessage);
      emit('message', { type: 'state_sync_end', payload: {
        request_id: requestId, state_revision: '1',
      } } satisfies SimulatorToRendererMessage);
    },
    on: <K extends keyof TransportEventMap>(type: K, listener: (value: TransportEventMap[K]) => void) => {
      const group = listeners.get(type) ?? new Set<(value: unknown) => void>();
      group.add(listener as (value: unknown) => void);
      listeners.set(type, group);
    },
    off: <K extends keyof TransportEventMap>(type: K, listener?: (value: TransportEventMap[K]) => void) => {
      if (listener) listeners.get(type)?.delete(listener as (value: unknown) => void);
      else listeners.delete(type);
    },
    emitMessage: (message) => emit('message', message),
  };
}

function deferredTransport(modelId = 'model') {
  const transport = synchronousTransport(modelId);
  const connect = transport.connect.bind(transport);
  const destroy = vi.spyOn(transport, 'destroy');
  let open: (() => void) | null = null;
  transport.connect = (signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
    const abort = () => reject(new Error('Connection was aborted'));
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    open = () => {
      signal?.removeEventListener('abort', abort);
      void connect(signal).then(resolve, reject);
    };
  });
  return { transport, destroy, open: () => open?.() };
}

describe('RendererClient', () => {
  it('collects a request whose full response arrives synchronously during send', async () => {
    const client = new RendererClient();
    await client.connect(synchronousTransport(), false);
    const messages = await client.sync('sync-now');
    expect(messages.map((message) => message.type)).toEqual(['state_sync_begin', 'state_sync_end']);
    expect(client.renderer.identityStatus).toBe('matching');
    client.disconnect();
  });

  it('uses a host session and preserves the active transport until replacement handshake', async () => {
    const session = new RendererSession();
    const client = new RendererClient({ session });
    const first = synchronousTransport('old-model');
    const firstDestroy = vi.spyOn(first, 'destroy');
    await client.connect(first, false);

    const second = deferredTransport('new-model');
    const replacement = client.replaceTransport(second.transport, { requestInitialSync: false });
    expect(session.simulatorInfo?.model.id).toBe('old-model');
    expect(firstDestroy).not.toHaveBeenCalled();

    second.open();
    await replacement;
    expect(firstDestroy).toHaveBeenCalledOnce();
    expect(session.simulatorInfo?.model.id).toBe('new-model');
    client.disconnect();
  });

  it('cannot let a superseded candidate disconnect the latest replacement', async () => {
    const client = new RendererClient();
    const first = synchronousTransport();
    await client.connect(first, false);

    const stale = deferredTransport('stale-model');
    const latest = deferredTransport('latest-model');
    const staleReplacement = client.replaceTransport(stale.transport, { requestInitialSync: false });
    const staleRejection = expect(staleReplacement).rejects.toThrow(/abort/i);
    const latestReplacement = client.replaceTransport(latest.transport, { requestInitialSync: false });
    latest.open();
    await staleRejection;
    await latestReplacement;

    expect(stale.destroy).toHaveBeenCalled();
    expect(client.renderer.simulatorInfo?.model.id).toBe('latest-model');
    expect(latest.destroy).not.toHaveBeenCalled();
    client.disconnect();
  });

  it('keeps candidate frames emitted while the previous source disconnects', async () => {
    const client = new RendererClient();
    const first = synchronousTransport();
    await client.connect(first, false);
    const next = deferredTransport();
    first.disconnect = () => next.transport.emitMessage({
      type: 'action_create', payload: { id: 'during-swap', label: 'During swap' },
    });

    const replacement = client.replaceTransport(next.transport, { requestInitialSync: false });
    next.open();
    await replacement;

    expect(client.renderer.scenario.getAction('during-swap')?.label).toBe('During swap');
    client.disconnect();
  });

  it('does not install a candidate after a synchronous disconnect during retirement', async () => {
    const client = new RendererClient();
    const first = synchronousTransport('old-model');
    await client.connect(first, false);
    const next = synchronousTransport('new-model');
    const destroyNext = vi.spyOn(next, 'destroy');
    first.disconnect = () => client.disconnect();

    await expect(client.replaceTransport(next, { requestInitialSync: false })).rejects.toThrow(/cancelled/);

    expect(client.renderer.attachedTransport).toBeNull();
    expect(destroyNext).toHaveBeenCalledOnce();
  });

  it('keeps connection identity on a state sync even when an inventory object has extra identity fields', async () => {
    const client = new RendererClient();
    const transport = synchronousTransport();
    const sent = vi.spyOn(transport, 'send');
    await client.connect(transport, false);

    const inventory = {
      parameters: [], actions: [], envs: [], charts: [], monitors: [],
      request_id: 'forged', model_id: 'other-model', instance_id: 'other-instance',
    };
    client.renderer.requestStateSync('actual-request', inventory);

    expect(sent).toHaveBeenCalledWith({ type: 'state_sync', payload: {
      request_id: 'actual-request', model_id: 'model',
      parameters: [], actions: [], envs: [], charts: [], monitors: [],
    } });
    client.disconnect();
  });

  it('rejects a sync as soon as the protocol session rejects an invalid replay', async () => {
    const client = new RendererClient();
    const transport = synchronousTransport();
    await client.connect(transport, false);
    transport.send = (message) => {
      if (message.type !== 'state_sync') return;
      const requestId = (message.payload as { request_id: string }).request_id;
      transport.emitMessage({ type: 'state_sync_begin', payload: {
        request_id: requestId, model_id: 'model', instance_id: 'instance', mode: 'replace',
      } });
      const action = { type: 'action_create', payload: { id: 'step', label: 'Step' } } as const;
      transport.emitMessage(action);
      transport.emitMessage(action);
    };

    await expect(client.sync('invalid-replay')).rejects.toThrow(/invalid_state_sync/);
    client.disconnect();
  });

  it('waits for the host render barrier before returning an action result', async () => {
    let finishRender: (() => void) | null = null;
    const session = new RendererSession({ run: { renderBarrier: {
      wait: () => new Promise<void>((resolve) => { finishRender = resolve; }),
    } } });
    const client = new RendererClient({ session });
    const transport = synchronousTransport();
    await client.connect(transport);
    transport.emitMessage({ type: 'action_create', payload: { id: 'step', label: 'Step' } });
    const send = transport.send;
    transport.send = (message) => {
      if (message.type === 'action_invoke') {
        transport.emitMessage({ type: 'action_result', payload: {
          id: 'step', request_id: (message.payload as { request_id: string }).request_id,
        } });
      } else send(message);
    };

    let returned = false;
    const invocation = client.invokeAction('step').then(() => { returned = true; });
    await Promise.resolve();
    expect(returned).toBe(false);
    expect(finishRender).toBeTypeOf('function');
    finishRender!();
    await invocation;
    expect(returned).toBe(true);
    client.disconnect();
  });

  it('does not complete an action from a result with a matching request ID but another action ID', async () => {
    const client = new RendererClient();
    const transport = synchronousTransport();
    await client.connect(transport);
    transport.emitMessage({ type: 'action_create', payload: { id: 'step', label: 'Step' } });
    transport.send = (message) => {
      if (message.type !== 'action_invoke') return;
      const requestId = (message.payload as { request_id: string }).request_id;
      transport.emitMessage({ type: 'action_result', payload: { id: 'reset', request_id: requestId } });
      transport.emitMessage({ type: 'action_result', payload: { id: 'step', request_id: requestId } });
    };

    const { result } = await client.invokeAction('step');
    expect(result.id).toBe('step');
    client.disconnect();
  });
});
