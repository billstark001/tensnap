import type {
  AnyProtocolMessage,
  ISimulatorTransport,
  ProtocolEncoding,
  RendererToSimulatorMessage,
  SimulatorToRendererMessage,
  TransportConnectionState,
  TransportEventHandler,
  TransportEventMap,
} from '@tensnap/core';
import { describe, expect, it } from 'vitest';
import { createScenarioStore } from './store';
import { registerEventHandlers, unregisterEventHandlers } from './scenario-ws';

class MockTransport implements ISimulatorTransport {
  readonly connectionId = 'mock://transport';
  readonly transportKind = 'mock';
  readonly encoding: ProtocolEncoding = 'json';
  readonly connectionState: TransportConnectionState = 'open';
  readonly isConnected = true;

  private handlers = new Map<keyof TransportEventMap, Set<TransportEventHandler<any>>>();

  async connect(): Promise<void> {
    return Promise.resolve();
  }

  disconnect(): void {
    // no-op for tests
  }

  destroy(): void {
    this.handlers.clear();
  }

  on<K extends keyof TransportEventMap>(
    type: K,
    handler: TransportEventHandler<TransportEventMap[K]>,
  ): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
  }

  off<K extends keyof TransportEventMap>(
    type: K,
    handler?: TransportEventHandler<TransportEventMap[K]>,
  ): void {
    if (!handler) {
      this.handlers.delete(type);
      return;
    }

    const group = this.handlers.get(type);
    if (!group) {
      return;
    }

    group.delete(handler);
    if (group.size === 0) {
      this.handlers.delete(type);
    }
  }

  send(_message: RendererToSimulatorMessage): void {
    // no-op for tests
  }

  emitMessage(message: SimulatorToRendererMessage): void {
    const group = this.handlers.get('message');
    if (!group) {
      return;
    }

    for (const handler of group) {
      handler(message as AnyProtocolMessage);
    }
  }
}

describe('scenario ws event handlers', () => {
  it('keeps applying inbound messages while sync is only requested', () => {
    const useStore = createScenarioStore();
    const transport = new MockTransport();

    useStore.getState().prepareStateSync('sync-1');
    registerEventHandlers(transport, useStore);

    transport.emitMessage({
      type: 'env_create',
      payload: { id: 'env-1', type: '2d' },
    });

    expect(useStore.getState().environments.has('env-1')).toBe(true);

    unregisterEventHandlers(transport);
  });
});