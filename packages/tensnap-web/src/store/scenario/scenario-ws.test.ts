import type {
  ISimulatorTransport,
  TransportConnectionState,
  TransportEventHandler,
  TransportEventMap,
} from '@tensnap/core';
import type {
  AnyProtocolMessage,
  ProtocolEncoding,
  ProtocolValidationWarning,
  RendererToSimulatorMessage,
  SimulatorToRendererMessage,
} from '@tensnap/protocol';
import { describe, expect, it } from 'vitest';
import { createScenarioStore } from './store';
import { createTransportStore } from '../transport';

class MockTransport implements ISimulatorTransport {
  readonly connectionId = 'mock://transport';
  readonly transportKind = 'mock';
  readonly encoding: ProtocolEncoding = 'json';
  readonly connectionState: TransportConnectionState = 'open';
  readonly isConnected = true;
  readonly sent: RendererToSimulatorMessage[] = [];

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

  send(message: RendererToSimulatorMessage): void {
    this.sent.push(message);
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

  emitValidationWarning(warning: ProtocolValidationWarning): void {
    for (const handler of this.handlers.get('validation-warning') ?? []) handler(warning);
  }

  emitError(error: unknown): void {
    for (const handler of this.handlers.get('error') ?? []) handler(error);
  }
}

describe('scenario ws event handlers', () => {
  it('routes simulator action errors into project diagnostics', async () => {
    const useStore = createScenarioStore();
    const useTransportStore = createTransportStore(useStore);
    const transport = new MockTransport();
    await useTransportStore.getState().initialize(transport);
    transport.emitMessage({
      type: 'simulator_info',
      payload: {
        protocol_version: '0.3',
        binding: { name: 'ws-test', version: '0.3.0' },
        model: { id: 'ws-model' },
        instance_id: 'ws-instance',
        capabilities: [],
      },
    });

    transport.emitMessage({
      type: 'action_result',
      payload: {
        id: 'step',
        request_id: 'step-1',
        error: { code: 'handler_error', message: 'Bool(::ElFarolModel)' },
      },
    });

    expect(useStore.getState().diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        domain: 'simulator',
        code: 'handler_error',
        target: 'step',
        message: 'Bool(::ElFarolModel)',
      }),
    ]);
    useTransportStore.getState().destroy();
  });

  it('routes validation warnings and transport errors into project diagnostics', async () => {
    const useStore = createScenarioStore();
    const useTransportStore = createTransportStore(useStore);
    const transport = new MockTransport();
    await useTransportStore.getState().initialize(transport);

    transport.emitValidationWarning({
      level: 'warning',
      direction: 'simulator-to-renderer',
      message: 'invalid monitor payload',
      issues: [],
    });
    transport.emitError(new Error('invalid protocol message'));

    expect(useStore.getState().diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'warning',
          code: 'validation_warning',
          message: 'invalid monitor payload',
        }),
        expect.objectContaining({
          severity: 'error',
          code: 'transport_error',
          message: 'invalid protocol message',
        }),
      ]),
    );
    useTransportStore.getState().destroy();
  });

  it('keeps applying inbound messages while sync is only requested', async () => {
    const useStore = createScenarioStore();
    const useTransportStore = createTransportStore(useStore);
    const transport = new MockTransport();
    await useTransportStore.getState().initialize(transport);
    transport.emitMessage({
      type: 'simulator_info',
      payload: {
        protocol_version: '0.3',
        binding: { name: 'ws-test', version: '0.3.0' },
        model: { id: 'ws-model' },
        instance_id: 'ws-instance',
        capabilities: [],
      },
    });

    transport.emitMessage({
      type: 'env_create',
      payload: { id: 'env-1', type: '2d' },
    });

    expect(useStore.getState().environments.has('env-1')).toBe(true);

    useTransportStore.getState().destroy();
  });

  it('publishes a state-sync replay to the UI only after its end boundary', async () => {
    const useStore = createScenarioStore();
    const useTransportStore = createTransportStore(useStore);
    const transport = new MockTransport();
    await useTransportStore.getState().initialize(transport);
    transport.emitMessage({
      type: 'simulator_info',
      payload: {
        protocol_version: '0.3',
        binding: { name: 'ws-test', version: '0.3.0' },
        model: { id: 'ws-model' },
        instance_id: 'ws-instance',
        capabilities: [],
      },
    });
    const request = transport.sent.find((message) => message.type === 'state_sync');
    expect(request).toBeDefined();
    const requestId = (request!.payload as { request_id: string }).request_id;
    const before = useStore.getState().environmentUpdateTrigger.value;
    transport.emitMessage({
      type: 'state_sync_begin',
      payload: {
        request_id: requestId,
        model_id: 'ws-model',
        instance_id: 'ws-instance',
        mode: 'replace',
      },
    });
    transport.emitMessage({ type: 'env_create', payload: { id: 'env-1', type: '2d' } });
    await Promise.resolve();

    expect(useStore.getState().environments.has('env-1')).toBe(false);
    expect(useStore.getState().environmentUpdateTrigger.value).toBe(before);

    transport.emitMessage({
      type: 'state_sync_end',
      payload: { request_id: requestId, state_revision: '1' },
    });
    await Promise.resolve();

    expect(useStore.getState().environments.has('env-1')).toBe(true);
    expect(useStore.getState().environmentUpdateTrigger.value).toBe(before + 1);
    useTransportStore.getState().destroy();
  });

  it('drops a screenshot captured for a connection that was replaced', async () => {
    const useStore = createScenarioStore();
    const useTransportStore = createTransportStore(useStore);
    const first = new MockTransport();
    await useTransportStore.getState().initialize(first);
    first.emitMessage({
      type: 'simulator_info',
      payload: {
        protocol_version: '0.3',
        binding: { name: 'ws-test', version: '0.3.0' },
        model: { id: 'ws-model' },
        instance_id: 'ws-instance',
        capabilities: [],
      },
    });
    let finishCapture!: (blob: Blob) => void;
    useStore.getState().registerScreenshotCapture(
      'env-1',
      () =>
        new Promise<Blob>((resolve) => {
          finishCapture = resolve;
        }),
    );
    first.emitMessage({
      type: 'screenshot_request',
      payload: {
        request_id: 'screen-1',
        env_id: 'env-1',
        format: 'png',
      },
    });

    const second = new MockTransport();
    await useTransportStore.getState().initialize(second);
    second.emitMessage({
      type: 'simulator_info',
      payload: {
        protocol_version: '0.3',
        binding: { name: 'ws-test', version: '0.3.0' },
        model: { id: 'ws-model' },
        instance_id: 'ws-instance-2',
        capabilities: [],
      },
    });
    expect(useStore.getState().session.isConnected).toBe(true);
    finishCapture(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }));
    await Promise.resolve();
    await Promise.resolve();

    expect(second.sent.some((message) => message.type === 'screenshot_response')).toBe(false);
    useTransportStore.getState().destroy();
  });
});
