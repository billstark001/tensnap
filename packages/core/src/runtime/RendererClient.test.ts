import { describe, expect, it } from 'vitest';
import type { RendererToSimulatorMessage, SimulatorToRendererMessage } from '@tensnap/protocol';
import type { ISimulatorTransport, TransportEventMap } from '../transport';
import { RendererClient } from './RendererClient';

function synchronousTransport(): ISimulatorTransport {
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
        model: { id: 'model' }, instance_id: 'instance', capabilities: [],
      } } satisfies SimulatorToRendererMessage);
    },
    disconnect: () => {}, destroy: () => {},
    send: (message: RendererToSimulatorMessage) => {
      if (message.type !== 'state_sync') return;
      const requestId = (message.payload as { request_id: string }).request_id;
      emit('message', { type: 'state_sync_begin', payload: {
        request_id: requestId, model_id: 'model', instance_id: 'instance', mode: 'replace',
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
  };
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
});
