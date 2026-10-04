/** Drive a real binding WebSocket through the public renderer session. */
import assert from 'node:assert/strict';
import {
  decodeProtocolMessage,
  encodeProtocolMessage,
  type AnyProtocolMessage,
  type SimulatorInfoPayload,
  type SimulatorToRendererMessage,
  type RendererToSimulatorMessage,
} from '../packages/protocol/src/index.ts';
import { RendererSession } from '../packages/core/src/runtime/RendererSession.ts';
import type { ISimulatorTransport } from '../packages/core/src/transport/index.ts';
import { runLiveClient } from './renderer-live-client.ts';

type Encoding = 'json' | 'msgpack';

class MessageQueue {
  private readonly pending: AnyProtocolMessage[] = [];
  private readonly waiters: Array<(message: AnyProtocolMessage) => void> = [];

  push(message: AnyProtocolMessage): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(message);
    else this.pending.push(message);
  }

  async next(): Promise<AnyProtocolMessage> {
    const ready = this.pending.shift();
    if (ready) return ready;
    return new Promise<AnyProtocolMessage>((resolve, reject) => {
      const waiter = (message: AnyProtocolMessage) => {
        clearTimeout(timer);
        resolve(message);
      };
      const timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error('Timed out waiting for host frame'));
      }, 8000);
      this.waiters.push(waiter);
    });
  }
}

async function connectHost(port: number): Promise<{ socket: WebSocket; queue: MessageQueue }> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  socket.binaryType = 'arraybuffer';
  const queue = new MessageQueue();
  socket.addEventListener('message', (event) => {
    queue.push(decodeProtocolMessage(event.data as string | ArrayBuffer));
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  return { socket, queue };
}

function transport(socket: WebSocket, encoding: Encoding): ISimulatorTransport {
  return {
    connectionId: 'conformance://renderer',
    transportKind: 'websocket',
    encoding,
    connectionState: 'open',
    isConnected: true,
    connect: async () => {},
    disconnect: () => socket.close(),
    destroy: () => socket.close(),
    on: () => {},
    off: () => {},
    send: (message: RendererToSimulatorMessage) => {
      const payload = encodeProtocolMessage(message as AnyProtocolMessage, encoding);
      socket.send(typeof payload === 'string' ? payload : new Uint8Array(payload));
    },
  };
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolve) => {
    socket.addEventListener('close', () => resolve(), { once: true });
    socket.close();
  });
}

function seedStaleState(session: RendererSession, label: string): void {
  session.scenario.apply({ type: 'env_create', payload: { id: label, type: '2d' } });
  session.scenario.apply({
    type: 'env_layer_create',
    payload: { env_id: label, layer_id: 'agents', layer_type: 'agent' },
  });
  session.scenario.apply({
    type: 'item_create',
    payload: { env_id: label, layer_id: 'agents', items: [{ id: `${label}-agent`, x: 1, y: 1 }] },
  });
  session.scenario.apply({ type: 'chart_create', payload: { id: `${label}-chart`, label } });
  session.scenario.apply({
    type: 'chart_update',
    payload: { updates: [{ id: `${label}-chart`, time: 0, value: 1 }] },
  });
}

async function handshake(
  session: RendererSession,
  queue: MessageQueue,
): Promise<SimulatorInfoPayload> {
  const first = await queue.next();
  assert.equal(first.type, 'simulator_info');
  session.handleIncoming(first as SimulatorToRendererMessage);
  return first.payload;
}

async function synchronize(
  session: RendererSession,
  queue: MessageQueue,
  requestId: string,
  staleLabel: string,
  corruptEnd = false,
): Promise<string[]> {
  const seen: string[] = [];
  session.requestStateSync(requestId);
  while (true) {
    const message = await queue.next();
    seen.push(message.type);
    if (message.type === 'state_sync_end') {
      assert.equal(message.payload.request_id, requestId);
      assert.ok(session.scenario.getEnvironment(staleLabel));
      assert.equal(session.scenario.charts.getGroup(`${staleLabel}-chart`)?.data.length, 1);
      if (corruptEnd) {
        session.handleIncoming({
          ...message,
          payload: { ...message.payload, request_id: 'mismatched-end' },
        });
        assert.ok(session.scenario.getEnvironment(staleLabel));
      } else {
        session.handleIncoming(message as SimulatorToRendererMessage);
        assert.equal(session.scenario.getEnvironment(staleLabel), undefined);
        assert.equal(session.scenario.charts.getGroup(`${staleLabel}-chart`), undefined);
        assert.ok(session.scenario.parameters.has('speed'));
      }
      return seen;
    }
    session.handleIncoming(message as SimulatorToRendererMessage);
    if (message.type === 'state_sync_begin') {
      assert.equal(message.payload.request_id, requestId);
      assert.ok(session.scenario.getEnvironment(staleLabel));
    }
  }
}

async function main(): Promise<void> {
  const [firstPort, secondPort, rawEncoding, binding, statePath] = process.argv.slice(2);
  const encoding = rawEncoding as Encoding;
  const perConnectionSession = binding === 'js';
  const session = new RendererSession();
  seedStaleState(session, 'pre-sync');
  const first = await connectHost(Number(firstPort));
  session.attachTransport(transport(first.socket, encoding));
  const firstInfo = await handshake(session, first.queue);
  const firstInstance = firstInfo.instance_id;
  const firstSync = await synchronize(session, first.queue, 'initial', 'pre-sync');
  assert.ok(firstSync.includes('state_sync_begin'));

  seedStaleState(session, 'committed');
  await synchronize(session, first.queue, 'bad-boundary', 'committed', true);
  session.detachTransport();
  await closeSocket(first.socket);
  assert.ok(session.scenario.getEnvironment('committed'));
  assert.equal(session.scenario.charts.getGroup('committed-chart')?.data.length, 1);

  const same = await connectHost(Number(firstPort));
  session.attachTransport(transport(same.socket, encoding));
  const sameInfo = await handshake(session, same.queue);
  const sameInstance = sameInfo.instance_id;
  assert.deepEqual({ ...sameInfo, instance_id: firstInstance }, firstInfo);
  if (perConnectionSession) {
    assert.notEqual(sameInstance, firstInstance);
    assert.equal(session.identityStatus, 'instance-changed');
  } else {
    assert.equal(sameInstance, firstInstance);
  }
  await synchronize(session, same.queue, 'same-instance-reconnect', 'committed');
  seedStaleState(session, 'old-instance');
  session.detachTransport();
  await closeSocket(same.socket);

  const second = await connectHost(Number(secondPort));
  session.attachTransport(transport(second.socket, encoding));
  const secondInfo = await handshake(session, second.queue);
  const secondInstance = secondInfo.instance_id;
  assert.notEqual(secondInstance, firstInstance);
  assert.deepEqual({ ...secondInfo, instance_id: firstInstance }, firstInfo);
  assert.equal(session.identityStatus, 'instance-changed');
  assert.ok(session.scenario.getEnvironment('old-instance'));
  const reconnect = await synchronize(session, second.queue, 'reconnect', 'old-instance');
  assert.ok(reconnect.includes('state_sync_begin'));
  assert.equal(session.scenario.parameters.get('speed')?.value, 1);
  assert.equal(session.identityStatus, 'matching');
  session.detachTransport();
  await closeSocket(second.socket);
  const liveRows = await runLiveClient(Number(secondPort), encoding, binding, statePath);
  process.stdout.write(
    JSON.stringify({
      ...liveRows,
      atomic_sync: { status: 'pass', evidence: { mismatched_end: true, disconnect: true } },
      reconnect: {
        status: 'pass',
        evidence: {
          ...liveRows.reconnect.evidence,
          previous_instance: firstInstance,
          same_instance_reconnect: sameInstance === firstInstance,
          new_instance: secondInstance,
          stale_items_and_chart_cleared: true,
        },
      },
    }),
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
