import { describe, expect, it } from 'vitest';
import type { SimulatorToRendererMessage } from '@tensnap/protocol';
import { connectWithHandshake } from './handshake';
import type { ISimulatorTransport, TransportEventMap } from './types';

function transport(frames: SimulatorToRendererMessage[], legacy = false): ISimulatorTransport {
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const emit = (type: string, value: unknown): void => {
    for (const listener of listeners.get(type) ?? []) listener(value);
  };
  return {
    connectionId: 'test', transportKind: 'test', encoding: 'json', connectionState: 'open', isConnected: true,
    connect: async () => {
      if (legacy) emit('protocol-mode', { mode: 'legacy', reason: 'handshake-timeout' });
      for (const frame of frames) emit('message', frame);
    },
    disconnect: () => {}, destroy: () => {}, send: () => {},
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

describe('transport handshake', () => {
  const info = { type: 'simulator_info', payload: {
    protocol_version: '0.3', model: { id: 'test' }, binding: { name: 'test', version: '1' },
    instance_id: 'one', capabilities: [],
  } } as SimulatorToRendererMessage;

  it('buffers a synchronous handshake and rejects a preceding state frame', async () => {
    const handshake = await connectWithHandshake(transport([info]));
    expect(handshake.mode).toBe('strict');
    expect(handshake.takeBufferedMessages()).toEqual([info]);
    expect(() => handshake.takeBufferedMessages()).toThrow(/already taken/);

    const wrong = { type: 'metadata_update', payload: { time: 1 } } as SimulatorToRendererMessage;
    await expect(connectWithHandshake(transport([wrong, info]))).rejects.toThrow(/first simulator message/);
  });

  it('accepts the negotiated legacy transport mode', async () => {
    const handshake = await connectWithHandshake(transport([], true));
    expect(handshake.mode).toBe('legacy');
    expect(handshake.takeBufferedMessages()).toEqual([]);
  });
});
