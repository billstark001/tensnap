/** Exercise live hosts through the same Node transport and RendererSession used by the agent. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RendererSession } from '../packages/core/src/runtime/RendererSession.ts';
import { RendererClient } from '../packages/core/src/runtime/RendererClient.ts';
import { NodeWebSocketTransport } from '../packages/tensnap-agent/src/session/NodeWebSocketTransport.ts';
import type { AnyProtocolMessage, ParameterSyncPayload, SimulatorToRendererMessage, StateSyncBeginPayload } from '../packages/protocol/src/index.ts';

type Encoding = 'json' | 'msgpack';
type Outcome = { status: 'pass'; evidence: Record<string, unknown> };
type HostAgent = { id: number; x: number; y: number; health: 'S' | 'I' | 'R' };
type HostState = { steps: number; speed: number; x: number; rng: number; queue: unknown;
  births: number; deaths: number; base_population: number; agents: HostAgent[] };

async function connect(port: number, encoding: Encoding, expectedModel?: string) {
  const client = new RendererClient();
  const session = client.renderer;
  if (expectedModel) session.setExpectedSimulatorIdentity({ model_id: expectedModel });
  const wire: AnyProtocolMessage[] = [];
  await client.connect(transport(port, encoding, wire), false);
  assert.equal(wire[0]?.type, 'simulator_info');
  const info = session.simulatorInfo;
  assert.ok(info);
  return { client, session, wire, info };
}

function transport(port: number, encoding: Encoding, wire?: AnyProtocolMessage[]): NodeWebSocketTransport {
  const connection = new NodeWebSocketTransport(`ws://127.0.0.1:${port}`, encoding,
    { clientMessages: 'error', serverMessages: 'error' });
  if (wire) connection.on('message', (message) => wire.push(message as AnyProtocolMessage));
  return connection;
}

function waitForMessage(session: RendererSession, predicate: (message: AnyProtocolMessage) => boolean): Promise<AnyProtocolMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for simulator message.')); }, 10_000);
    const onMessage = (event: Event): void => {
      const message = (event as CustomEvent<{ message: AnyProtocolMessage }>).detail.message;
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };
    const onClose = (): void => { cleanup(); reject(new Error('Disconnected before simulator message arrived.')); };
    const cleanup = (): void => {
      clearTimeout(timeout);
      session.removeEventListener('message', onMessage);
      session.removeEventListener('transport:close', onClose);
    };
    session.addEventListener('message', onMessage);
    session.addEventListener('transport:close', onClose);
  });
}

function state(path: string): HostState {
  return JSON.parse(readFileSync(path, 'utf8')) as HostState;
}

async function untilState(path: string, key: keyof HostState, value: unknown): Promise<void> {
  for (let i = 0; i < 400; i++) {
    try {
      if (state(path)[key] === value) return;
    } catch (error) {
      // Go and Julia rewrite the diagnostic sidecar in place. A concurrent
      // read may observe an empty or partial file; wait for the next complete
      // state rather than treating that transient read as a model failure.
      if (!(error instanceof SyntaxError)
        && !(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Host ${key} did not become ${String(value)}`);
}

function project(session: RendererSession, host: HostState): void {
  const snapshot = session.scenario.dump();
  const study = snapshot.environments.find((env) => env.id === 'study');
  assert.equal(study?.type, '2d');
  assert.deepEqual(study.layers.map((layer) => layer.id).sort(), ['agents', 'grid']);
  const grid = study.layers.find((layer) => layer.id === 'grid');
  assert.equal(grid?.metadata.width, 64);
  assert.equal(grid?.metadata.height, 64);
  const layer = study.layers.find((entry) => entry.id === 'agents');
  const agents = (layer?.storageSnapshot as { agents: Array<{ id: number; x: number; y: number; color: string; data: { health: string } }> }).agents;
  const colors = { S: '#3498db', I: '#e74c3c', R: '#2ecc71' };
  const expected = host.agents.map((agent) => ({ id: agent.id, x: agent.x, y: agent.y,
    color: colors[agent.health], data: { health: agent.health } }));
  assert.deepEqual([...agents].sort((a, b) => a.id - b.id), expected.sort((a, b) => a.id - b.id));
  assert.equal(session.scenario.monitors.get('population')?.value, host.agents.length);
  const counts = { susceptible: 0, infected: 0, recovered: 0 };
  for (const agent of host.agents) counts[{ S: 'susceptible', I: 'infected', R: 'recovered' }[agent.health] as keyof typeof counts]++;
  for (const [id, count] of Object.entries(counts)) assert.equal(session.scenario.charts.getLatestValue(id), count);
}

async function sync(client: Awaited<ReturnType<typeof connect>>, id: string): Promise<SimulatorToRendererMessage[]> {
  const messages = await client.client.sync(id);
  assert.equal((messages.find((message) => message.type === 'state_sync_begin')?.payload as StateSyncBeginPayload | undefined)?.request_id, id);
  return messages;
}

async function action(client: Awaited<ReturnType<typeof connect>>, id = 'step'): Promise<SimulatorToRendererMessage[]> {
  let result: Awaited<ReturnType<RendererClient['invokeAction']>>['result'];
  let messages: Awaited<ReturnType<RendererClient['invokeAction']>>['messages'];
  try { ({ result, messages } = await client.client.invokeAction(id)); }
  catch (error) {
    throw new Error(`${String(error)}; recent wire: ${client.wire.slice(-8).map((message) => message.type).join(',')}; run: ${JSON.stringify(client.session.run.status)}`);
  }
  assert.equal(messages.at(-1)?.type, 'action_result');
  assert.equal((messages.at(-1)?.payload as { request_id: string } | undefined)?.request_id, result.request_id);
  return messages;
}

async function capture(client: Awaited<ReturnType<typeof connect>>) {
  const result = await client.session.captureScene();
  assert.ok(result.checkpoint);
  return result;
}

async function restore(client: Awaited<ReturnType<typeof connect>>, checkpoint: NonNullable<Awaited<ReturnType<typeof capture>>['checkpoint']>, time: number) {
  const result = await client.session.restoreScene({ checkpoint, time,
    state_schema_version: '1', expected_instance_id: client.info.instance_id }, { chartPolicy: 'truncate' });
  assert.equal(result.status, 'ok', JSON.stringify(result));
}

export async function runLiveClient(port: number, encoding: Encoding, binding: string, basePath: string): Promise<Record<string, Outcome>> {
  // Readiness and fault-injection connections have already used sessions 0 and 1.
  const path = binding === 'js' ? `${basePath}.2` : basePath;
  const client = await connect(port, encoding);
  const rows: Record<string, Outcome> = {};
  let lastPassed = 'connection';
  const pass = (row: string, evidence: Record<string, unknown>) => {
    rows[row] = { status: 'pass', evidence };
    lastPassed = row;
  };
  try {
    assert.equal(client.info.protocol_version, '0.3');
    assert.equal(client.info.model.id, 'conformance.counter');
    assert.equal(client.info.binding.name, `tensnap-${binding}`);
    assert.equal(client.session.modelIdentity?.instance_id, client.info.instance_id);
    pass('identity_handshake', { actual_transport: 'NodeWebSocketTransport', instance_id: client.info.instance_id });

    const initial = state(path);
    await sync(client, 'renderer-initial');
    project(client.session, initial);
    assert.deepEqual(state(path), initial);
    pass('spatial_population', { population: initial.agents.length, host_unchanged: true });

    const before = state(path);
    const stepped = await action(client);
    const after = state(path);
    assert.equal(after.steps, before.steps + 1);
    assert.notDeepEqual(after.rng, before.rng);
    assert.notDeepEqual(after.queue, before.queue);
    assert.ok(stepped.slice(0, -1).some((message) => message.type === 'metadata_update'));
    project(client.session, after);
    await sync(client, 'renderer-read-only');
    assert.deepEqual(state(path), after);
    pass('host_only_transition', { steps: [before.steps, after.steps], read_only_sync: true });

    const correlated = await action(client);
    assert.equal(state(path).steps, after.steps + 1);
    project(client.session, state(path));
    const rejectBefore = state(path);
    const failed = await action(client, 'fail');
    assert.ok('error' in failed.at(-1)!.payload);
    assert.deepEqual(state(path), rejectBefore);
    pass('action_correlation', { action_result_last: true, rejected_actions: ['fail'],
      correlated_frames: correlated.map((message) => message.type) });

    client.session.setParameter('speed', 2);
    assert.equal(client.session.scenario.parameters.get('speed')?.value, 2);
    await untilState(path, 'speed', 2);
    const accepted = await sync(client, 'renderer-accepted-param');
    assert.ok(!accepted.some((message) => message.type === 'param_sync'));
    const correction = waitForMessage(client.session, (message) => message.type === 'param_sync' && message.payload.id === 'speed');
    client.session.setParameter('speed', 9);
    assert.equal(((await correction).payload as ParameterSyncPayload).value, 5);
    assert.equal(client.session.scenario.parameters.get('speed')?.value, 5);
    assert.equal(state(path).speed, 5);
    pass('parameter_control', { accepted: 2, normalized: 5, optimistic: true });

    client.session.setParameter('speed', 0);
    await untilState(path, 'speed', 0);
    const zero = state(path);
    await action(client);
    assert.equal(state(path).x, zero.x);
    assert.equal(state(path).steps, zero.steps + 1);
    client.session.setParameter('speed', 5);
    await untilState(path, 'speed', 5);
    const lower = waitForMessage(client.session, (message) => message.type === 'param_sync' && message.payload.id === 'speed');
    client.session.setParameter('speed', -100);
    assert.equal(((await lower).payload as ParameterSyncPayload).value, 0);
    assert.equal(client.session.scenario.parameters.get('speed')?.value, 0);
    pass('parameter_extremes', { zero_rate_step: true, accepted_max: 5, normalized_min: 0 });

    const churnStart = state(path);
    for (let i = 0; i < 6; i++) {
      await action(client);
      project(client.session, state(path));
    }
    const churnEnd = state(path);
    assert.equal(churnEnd.births - churnStart.births, 3);
    assert.equal(churnEnd.deaths - churnStart.deaths, 2);
    pass('population_churn', { steps: 6, births: 3, deaths: 2, projection_checked_each_step: true });

    const checkpointBaseline = state(path);
    const checkpoint = await capture(client);
    assert.deepEqual(state(path), checkpointBaseline);
    await action(client);
    assert.notDeepEqual(state(path), checkpointBaseline);
    await restore(client, checkpoint.checkpoint!, checkpointBaseline.steps);
    assert.deepEqual(state(path), checkpointBaseline);
    project(client.session, checkpointBaseline);
    pass('exact_checkpoint', { complete_host_state_restored: true, population: checkpointBaseline.agents.length });

    const replayBaseline = state(path);
    const replayCheckpoint = await capture(client);
    const first: HostState[] = [];
    for (let i = 0; i < 3; i++) { await action(client); first.push(state(path)); project(client.session, first.at(-1)!); }
    await restore(client, replayCheckpoint.checkpoint!, replayBaseline.steps);
    assert.deepEqual(state(path), replayBaseline);
    const second: HostState[] = [];
    for (let i = 0; i < 3; i++) { await action(client); second.push(state(path)); project(client.session, second.at(-1)!); }
    assert.deepEqual(second, first);
    pass('future_replay', { complete_host_states_compared: 3, projection_checked_each_step: true });

    await action(client, 'seed_dense');
    const dense = state(path);
    assert.equal(dense.agents.length, 1024);
    project(client.session, dense);
    await sync(client, 'renderer-dense-sync');
    project(client.session, dense);
    assert.deepEqual(state(path), dense);
    pass('dense_population', { population: 1024, live_and_full_sync: true });

    const oldIds = new Set(dense.agents.map((agent) => agent.id));
    await action(client, 'clear_population');
    const empty = state(path);
    assert.equal(empty.agents.length, 0);
    project(client.session, empty);
    await sync(client, 'renderer-empty-sync');
    project(client.session, empty);
    await action(client);
    assert.equal(state(path).agents.length, 0);
    await action(client, 'seed_dense');
    const reseeded = state(path);
    assert.equal(reseeded.agents.length, 1024);
    assert.ok(reseeded.agents.every((agent) => !oldIds.has(agent.id)));
    project(client.session, reseeded);
    pass('empty_reseed', { empty_absorbing_step: true, population: 1024, ids_disjoint: true });

    const denseCheckpoint = await capture(client);
    const denseBaseline = state(path);
    const denseFirst: HostState[] = [];
    for (let i = 0; i < 4; i++) { await action(client); denseFirst.push(state(path)); project(client.session, denseFirst.at(-1)!); }
    await restore(client, denseCheckpoint.checkpoint!, denseBaseline.steps);
    assert.deepEqual(state(path), denseBaseline);
    project(client.session, denseBaseline);
    const denseSecond: HostState[] = [];
    for (let i = 0; i < 4; i++) { await action(client); denseSecond.push(state(path)); project(client.session, denseSecond.at(-1)!); }
    assert.deepEqual(denseSecond, denseFirst);
    pass('dense_checkpoint_replay', { population: 1024, complete_host_states_compared: 4 });

    const inspectorPath = binding === 'js' ? `${basePath}.3` : path;
    const inspector = await connect(port, encoding);
    try {
      assert.equal(inspector.info.instance_id === client.info.instance_id, binding !== 'js');
      const inspectedBefore = state(inspectorPath);
      const primaryBefore = state(path);
      await sync(inspector, 'renderer-inspector-initial');
      project(inspector.session, inspectedBefore);
      assert.deepEqual(state(path), primaryBefore);
      assert.deepEqual(state(inspectorPath), inspectedBefore);
      await action(client);
      const primaryAfter = state(path);
      assert.equal(primaryAfter.steps, primaryBefore.steps + 1);
      const expectedInspector = binding === 'js' ? inspectedBefore : primaryAfter;
      await sync(inspector, 'renderer-inspector-refresh');
      project(inspector.session, expectedInspector);
      assert.deepEqual(state(inspectorPath), expectedInspector);
      pass('multi_client_inspection', { session_scope: binding === 'js' ? 'isolated' : 'shared',
        inspection_advanced_host: false, primary_action_advanced_once: true });
    } finally { inspector.client.disconnect(); }

    const mismatchBefore = state(path);
    const mismatch = await connect(port, encoding, 'wrong.model');
    try {
      assert.equal(mismatch.session.identityStatus, 'model-mismatch');
      assert.throws(() => mismatch.session.requestStateSync('wrong-model'));
      assert.deepEqual(state(path), mismatchBefore);
    } finally { mismatch.client.disconnect(); }
    pass('negative_identity_capability', { expected_model_mismatch_blocked: true, host_unchanged: true });

    const previousInstance = client.session.simulatorInfo?.instance_id;
    client.client.disconnect();
    await client.client.connect(transport(port, encoding, client.wire), false);
    const reconnectedInfo = client.session.simulatorInfo;
    assert.ok(reconnectedInfo);
    assert.equal(reconnectedInfo.instance_id === previousInstance, binding !== 'js');
    const reconnectedPath = binding === 'js' ? `${basePath}.5` : path;
    const reconnectedState = state(reconnectedPath);
    await sync(client, 'renderer-client-reconnect');
    project(client.session, reconnectedState);
    assert.equal(client.session.identityStatus, 'matching');
    pass('reconnect', { reused_client_object: true, new_handshake_observed: true,
      session_scope: binding === 'js' ? 'isolated' : 'shared' });

    return rows;
  } catch (error) {
    throw new Error(`Renderer live probe after ${lastPassed}: ${error instanceof Error ? error.stack : String(error)}`);
  } finally { client.client.disconnect(); }
}
