// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SimulatorSession } from '@tensnap/js/runtime';
import type { ProtocolEncoding } from '@tensnap/protocol';
import type { ProtocolBenchmarkWorkload } from '../harness/types';
import { runWsReplicate } from './runner';

const fault = vi.hoisted(() => ({ closeOn: '' }));
vi.mock('@tensnap/js/transport', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tensnap/js/transport')>();
  return {
    ...original,
    createWebSocketTransportHost(
      options: Parameters<typeof original.createWebSocketTransportHost>[0],
    ) {
      const host = original.createWebSocketTransportHost({
        ...options,
        onRendererMessage(message, bytes) {
          options.onRendererMessage?.(message, bytes);
          if (message.type === fault.closeOn) {
            for (const socket of host.server.clients) socket.close(1011, 'fixture disconnect');
          }
        },
      });
      return host;
    },
  };
});

function workload(failAt?: 'sync' | 'action'): ProtocolBenchmarkWorkload {
  return {
    schemaVersion: 2,
    id: 'ws-fixture',
    version: 1,
    kind: 'protocol',
    category: 'publication',
    description: 'WebSocket failure fixture',
    supportedSuites: ['ws'],
    protocolVersion: '0.3',
    modelId: 'ws-fixture',
    actionId: 'step',
    actionContinuous: false,
    resolveConfig: () => ({}),
    createSession: () =>
      new SimulatorSession({
        simulatorInfo: {
          protocol_version: '0.3',
          binding: { name: 'fixture', version: '0.3.0' },
          model: { id: 'ws-fixture' },
          instance_id: 'fixture',
          capabilities: [],
        },
        async onStateSync(payload, session) {
          if (fault.closeOn === 'state_sync') return;
          if (failAt === 'sync') {
            await session.emitter.error({
              code: 'sync_failed',
              message: 'fixture sync error',
              request_id: payload.request_id,
            });
            return;
          }
          await session.emitter.stateSyncBegin({
            request_id: payload.request_id,
            model_id: 'ws-fixture',
            instance_id: 'fixture',
            mode: 'replace',
          });
          await session.emitter.stateSyncEnd({
            request_id: payload.request_id,
            state_revision: '0',
          });
        },
        async onActionInvoke(payload, session) {
          if (fault.closeOn === 'action_invoke') return;
          if (failAt === 'action') {
            await session.emitter.error({
              code: 'dispatch_failed',
              message: 'fixture action error',
              request_id: payload.request_id,
            });
            return;
          }
          await session.emitter.actionResult({
            id: payload.id,
            request_id: payload.request_id,
            should_continue: false,
          });
        },
      }),
    createSemanticValidator: () => ({ observe() {}, assert() {}, snapshot: () => ({}) }),
    expectedState: () => ({}),
  };
}

describe('WebSocket benchmark completion', () => {
  afterEach(() => {
    fault.closeOn = '';
  });

  it.each(['json', 'msgpack'] as const)(
    'completes sync and correlated actions over %s',
    async (encoding) => {
      const sample = await runWsReplicate(workload(), {}, encoding, 'error', 1, 2, 0);
      expect(sample.correctness.valid).toBe(true);
      expect(sample.timingsMs).toHaveLength(2);
      expect(sample.messageCounts.action_result).toBe(3);
    },
  );

  for (const encoding of ['json', 'msgpack'] as ProtocolEncoding[]) {
    it.each(['sync', 'action'] as const)(
      `reports standalone protocol errors during %s (${encoding})`,
      async (phase) => {
        await expect(runWsReplicate(workload(phase), {}, encoding, 'off', 0, 1, 1)).rejects.toThrow(
          phase === 'sync'
            ? 'sync_failed: fixture sync error (request benchmark-initial-sync)'
            : 'dispatch_failed: fixture action error (request benchmark-action-0)',
        );
      },
      2_000,
    );

    it.each(['state_sync', 'action_invoke'])(
      `reports connection closure during %s (${encoding})`,
      async (messageType) => {
        fault.closeOn = messageType;
        await expect(
          runWsReplicate(workload(), { agentCount: 1000 }, encoding, 'off', 0, 1, 1),
        ).rejects.toThrow(
          /WebSocket closed before completion: 1011: fixture disconnect\.[\s\S]*config=\{"agentCount":1000\}[\s\S]*block=2; received=/,
        );
      },
      2_000,
    );
  }
});
