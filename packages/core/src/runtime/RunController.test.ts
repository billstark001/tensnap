import type { ISimulatorTransport, TransportConnectionState, TransportEventHandler, TransportEventMap } from '../transport';
import type { ProtocolEncoding, RendererToSimulatorMessage } from '@tensnap/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RendererSession } from './RendererSession';
import { compileRunCondition, createRunConditionScope } from './ScenarioConditionScope';

function createTransport(sent: RendererToSimulatorMessage[]): ISimulatorTransport {
  return {
    connectionId: 'test://run-controller',
    transportKind: 'test',
    encoding: 'json' as ProtocolEncoding,
    connectionState: 'open' as TransportConnectionState,
    isConnected: true,
    connect: async () => {},
    disconnect: () => {},
    destroy: () => {},
    on: <K extends keyof TransportEventMap>(_type: K, _handler: TransportEventHandler<TransportEventMap[K]>) => {},
    off: <K extends keyof TransportEventMap>(_type: K, _handler?: TransportEventHandler<TransportEventMap[K]>) => {},
    send: (message) => sent.push(message),
  };
}

function tickId(message: RendererToSimulatorMessage): string {
  const payload = message.payload as { request_id?: string };
  if (!payload.request_id) throw new Error('Expected dispatched action to have a tick id.');
  return payload.request_id;
}

function announce(session: RendererSession): void {
  session.handleIncoming({
    type: 'simulator_info',
    payload: {
      protocol_version: '0.3',
      binding: { name: 'test-binding', version: '0.3.0' },
      model: { id: 'test-model' },
      instance_id: 'test-instance',
      capabilities: [],
    },
  });
}

describe('RunController', () => {
  afterEach(() => vi.useRealTimers());

  it('rejects requests without an explicit run mode', () => {
    const session = new RendererSession();
    expect(() => session.run.start({ actionId: 'step', maxSteps: 2 } as never))
      .toThrow(/mode/);
  });

  it('requires request_id to correlate an action result', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session);

    session.run.requestAction('step');
    const requestId = tickId(sent[0]!);

    expect(session.run.observeActionResult({ id: 'step' } as never)).toBe(false);
    expect(session.run.observeActionResult({ id: 'step', request_id: 'other' } as never)).toBe(false);
    expect(session.run.observeActionResult({ id: 'step', request_id: requestId })).toBe(true);
  });

  it('runs at most maxSteps and waits for the host render barrier between steps', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session);

    session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 2 });
    const first = tickId(sent[0]!);
    session.handleIncoming({ type: 'action_result', payload: { id: 'step', request_id: first, should_continue: true } });

    expect(sent).toHaveLength(1);
    expect(session.run.status).toMatchObject({ state: 'running', completedSteps: 1 });

    session.run.markActionRendered({ id: 'step', request_id: first });
    expect(sent).toHaveLength(2);

    const second = tickId(sent[1]!);
    session.handleIncoming({ type: 'action_result', payload: { id: 'step', request_id: second, should_continue: true } });
    session.run.markActionRendered({ id: 'step', request_id: second });

    expect(sent).toHaveLength(2);
    expect(session.run.status).toMatchObject({
      state: 'stopped',
      completedSteps: 2,
      stopReason: 'max-steps',
    });
  });

  it('publishes one continuing status update per completed render', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    const onStatus = vi.fn();
    session.addEventListener('run:status', onStatus);
    session.attachTransport(createTransport(sent));
    announce(session);

    session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 3 });
    expect(onStatus).toHaveBeenCalledTimes(1);

    const first = tickId(sent[0]!);
    session.handleIncoming({ type: 'action_result', payload: { id: 'step', request_id: first, should_continue: true } });
    expect(onStatus).toHaveBeenCalledTimes(1);

    session.run.markActionRendered({ id: 'step', request_id: first });
    expect(onStatus).toHaveBeenCalledTimes(2);
  });

  it('runs in manual mode without a fake maximum and pauses after the in-flight tick', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session);

    session.run.start({ mode: 'manual', actionId: 'start' });
    const first = tickId(sent[0]!);
    expect(session.run.status).toMatchObject({
      state: 'running',
      spec: { mode: 'manual', actionId: 'start' },
      inFlight: true,
    });

    session.run.pause();
    expect(session.run.status).toMatchObject({ state: 'running', pauseRequested: true, inFlight: true });
    session.handleIncoming({ type: 'action_result', payload: { id: 'start', request_id: first, should_continue: true } });
    expect(session.run.status).toMatchObject({ state: 'paused', stopReason: 'paused', completedSteps: 1 });
    session.run.markActionRendered({ id: 'start', request_id: first });
    expect(sent).toHaveLength(1);
  });

  it('queues one step behind a manual run tick without duplicate dispatch', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session);

    session.run.start({ mode: 'manual', actionId: 'start' });
    const first = tickId(sent[0]!);
    session.run.requestStep('step');
    expect(sent).toHaveLength(1);

    session.handleIncoming({ type: 'action_result', payload: { id: 'start', request_id: first, should_continue: true } });
    session.run.markActionRendered({ id: 'start', request_id: first });
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ type: 'action_invoke', payload: { id: 'step', continuous: false } });
  });

  it('does not start a second continuous generation before the prior tick renders', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session);
    session.run.start({ mode: 'manual', actionId: 'start' });
    const first = tickId(sent[0]!);
    session.run.pause();
    session.handleIncoming({ type: 'action_result', payload: { id: 'start', request_id: first, should_continue: true } });

    expect(session.run.status).toMatchObject({ state: 'paused', inFlight: true });
    expect(() => session.run.start({ mode: 'manual', actionId: 'start' })).toThrow(/current action tick/);
    session.run.markActionRendered({ id: 'start', request_id: first });
    expect(session.run.status).toMatchObject({ state: 'paused', inFlight: false });
    expect(() => session.run.start({ mode: 'manual', actionId: 'start' })).not.toThrow();
    expect(sent).toHaveLength(2);
  });

  it('evaluates a compiled condition against incremental scenario state after action_result', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session);

    session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 9, stopWhen: 'steps >= 1 && metadata.population === 3' });
    const first = tickId(sent[0]!);
    session.handleIncoming({ type: 'metadata_update', payload: { population: 3 } });
    session.handleIncoming({ type: 'action_result', payload: { id: 'step', request_id: first, should_continue: true } });

    expect(session.run.status).toMatchObject({
      state: 'stopped',
      completedSteps: 1,
      conditionValue: true,
      stopReason: 'condition',
    });
  });

  it('stops an active bounded run before dispatching an ordinary action', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session);

    session.run.start({ mode: 'bounded', actionId: 'start', maxSteps: 10 });
    const pendingRunAction = tickId(sent[0]!);
    session.run.requestAction('step');

    expect(session.run.status).toMatchObject({ state: 'stopped', stopReason: 'stopped' });
    session.handleIncoming({ type: 'action_result', payload: { id: 'start', request_id: pendingRunAction, should_continue: true } });
    session.run.markActionRendered({ id: 'start', request_id: pendingRunAction });
    expect(sent[sent.length - 1]).toMatchObject({ type: 'action_invoke', payload: { id: 'step', continuous: false } });
  });

  it('invokes a declared stop hook after the current action renders', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));
    announce(session);
    session.scenario.apply({ type: 'action_create', payload: { id: 'stop', label: 'Stop' } });

    session.run.start({ mode: 'manual', actionId: 'step' });
    const stepId = tickId(sent[0]!);
    session.run.stop();
    expect(sent).toHaveLength(1);

    session.handleIncoming({ type: 'action_result', payload: { id: 'step', request_id: stepId, should_continue: true } });
    session.run.markActionRendered({ id: 'step', request_id: stepId });

    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ type: 'action_invoke', payload: { id: 'stop', continuous: false } });
    const stopId = tickId(sent[1]!);
    session.handleIncoming({ type: 'action_result', payload: { id: 'stop', request_id: stopId } });
    session.run.markActionRendered({ id: 'stop', request_id: stopId });
    expect(session.run.status).toMatchObject({ state: 'stopped', inFlight: false });
  });

  it('allows only the documented agent capabilities in stop expressions', () => {
    const session = new RendererSession();
    session.scenario.apply({ type: 'env_create', payload: { id: 'main', type: '2d' } });
    session.scenario.apply({
      type: 'env_layer_create',
      payload: { env_id: 'main', layer_id: 'agents', layer_type: 'agent', metadata: {} },
    });
    session.scenario.apply({
      type: 'item_create',
      payload: { env_id: 'main', layer_id: 'agents', items: [{ id: 'a', x: 2, y: 4 }] },
    });

    const condition = compileRunCondition('agentCount("main", "agents") === 1 && agent("main", "agents", "a").x === 2');
    expect(condition.evaluate(createRunConditionScope(session.scenario, 7))).toBe(true);
    expect(() => compileRunCondition('metadata.toString()')).toThrow(/Only agent/);
    expect(() => compileRunCondition('metadata.count = 1')).toThrow(/Assignment/);
    expect(() => compileRunCondition('/x/.test("x")')).toThrow();
  });

  it('reuses read-only condition views until their source revisions change', () => {
    const session = new RendererSession();
    session.scenario.apply({ type: 'param_create', payload: { id: 'speed', type: 'number', label: 'Speed', value: 2 } });
    session.scenario.apply({ type: 'chart_create', payload: { id: 'population', label: 'Population' } });
    session.scenario.apply({ type: 'chart_update', payload: { updates: [{ id: 'population', time: 1, value: 10 }] } });
    const getData = vi.spyOn(session.scenario.charts, 'getData');

    const first = createRunConditionScope(session.scenario, 1);
    const second = createRunConditionScope(session.scenario, 2);
    expect(second.metadata).toBe(first.metadata);
    expect(second.parameters).toBe(first.parameters);
    expect(second.charts).toBe(first.charts);
    expect(second.charts.population).toBe(10);
    expect(getData).not.toHaveBeenCalled();

    session.scenario.apply({ type: 'metadata_update', payload: { phase: 'next' } });
    session.scenario.apply({ type: 'chart_update', payload: { updates: [{ id: 'population', time: 2, value: 11 }] } });
    const updated = createRunConditionScope(session.scenario, 3);
    expect(updated.metadata).not.toBe(first.metadata);
    expect(updated.parameters).toBe(first.parameters);
    expect(updated.charts).not.toBe(first.charts);
    expect(updated.charts.population).toBe(11);
  });

  it('stops a bounded run when its in-flight action times out', async () => {
    vi.useFakeTimers();
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession({ run: { actionTimeoutMs: 10 } });
    session.attachTransport(createTransport(sent));
    announce(session);

    session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 2 });
    expect(sent).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10);

    expect(session.run.status).toMatchObject({ state: 'stopped', stopReason: 'action-timeout' });
  });

  it('records a rejected render barrier and stops the affected run without an unhandled rejection', async () => {
    const sent: RendererToSimulatorMessage[] = [];
    const onRenderBarrierError = vi.fn();
    const session = new RendererSession({
      run: {
        renderBarrier: { wait: () => Promise.reject(new Error('canvas lost')) },
        onRenderBarrierError,
      },
    });
    session.attachTransport(createTransport(sent));
    announce(session);

    session.run.start({ mode: 'bounded', actionId: 'step', maxSteps: 2 });
    const first = tickId(sent[0]!);
    session.handleIncoming({ type: 'action_result', payload: { id: 'step', request_id: first, should_continue: true } });
    await Promise.resolve();
    await Promise.resolve();

    expect(onRenderBarrierError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ id: first }), expect.anything());
    expect(session.run.status).toMatchObject({
      state: 'stopped',
      stopReason: 'render-error',
      renderError: 'canvas lost',
    });
    expect(sent).toHaveLength(1);
  });
});
