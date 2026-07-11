import type { ISimulatorTransport, TransportConnectionState, TransportEventHandler, TransportEventMap } from '../transport';
import type { ProtocolEncoding, RendererToSimulatorMessage } from '@tensnap/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RendererSession } from './RendererSession';
import { MAX_INT32_RUN_STEPS } from './RunController';
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
  const payload = message.payload as { tick_id?: string };
  if (!payload.tick_id) throw new Error('Expected dispatched action to have a tick id.');
  return payload.tick_id;
}

describe('RunController', () => {
  afterEach(() => vi.useRealTimers());
  it('runs at most maxSteps and waits for the host render barrier between steps', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));

    session.run.start({ actionId: 'step', maxSteps: 2 });
    const first = tickId(sent[0]!);
    session.handleIncoming({ type: 'action_end', payload: { id: 'step', tick_id: first, continue: true } });

    expect(sent).toHaveLength(1);
    expect(session.run.status).toMatchObject({ state: 'running', completedSteps: 1 });

    session.run.markActionRendered({ id: 'step', tick_id: first });
    expect(sent).toHaveLength(2);

    const second = tickId(sent[1]!);
    session.handleIncoming({ type: 'action_end', payload: { id: 'step', tick_id: second, continue: true } });
    session.run.markActionRendered({ id: 'step', tick_id: second });

    expect(sent).toHaveLength(2);
    expect(session.run.status).toMatchObject({
      state: 'stopped',
      completedSteps: 2,
      stopReason: 'max-steps',
    });
  });

  it('allows the legacy long-running button limit only when the host explicitly raises its policy', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession({ run: { maxStepsPolicy: MAX_INT32_RUN_STEPS } });
    session.attachTransport(createTransport(sent));

    session.run.start({ actionId: 'start', maxSteps: MAX_INT32_RUN_STEPS });

    expect(session.run.status).toMatchObject({ state: 'running', spec: { maxSteps: MAX_INT32_RUN_STEPS } });
    expect(sent).toHaveLength(1);
  });

  it('evaluates a compiled condition against incremental scenario state after action_end', () => {
    const sent: RendererToSimulatorMessage[] = [];
    const session = new RendererSession();
    session.attachTransport(createTransport(sent));

    session.run.start({ actionId: 'step', maxSteps: 9, stopWhen: 'steps >= 1 && metadata.population === 3' });
    const first = tickId(sent[0]!);
    session.handleIncoming({ type: 'metadata_update', payload: { population: 3 } });
    session.handleIncoming({ type: 'action_end', payload: { id: 'step', tick_id: first, continue: true } });

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

    session.run.start({ actionId: 'start', maxSteps: 10 });
    const pendingRunAction = tickId(sent[0]!);
    session.run.requestAction('step');

    expect(session.run.status).toMatchObject({ state: 'stopped', stopReason: 'stopped' });
    session.handleIncoming({ type: 'action_end', payload: { id: 'start', tick_id: pendingRunAction, continue: true } });
    session.run.markActionRendered({ id: 'start', tick_id: pendingRunAction });
    expect(sent[sent.length - 1]).toMatchObject({ type: 'action_start', payload: { id: 'step', continuous: false } });
  });

  it('allows only the documented agent capabilities in stop expressions', () => {
    const session = new RendererSession();
    session.scenario.apply({ type: 'env_create', payload: { id: 'main', type: '2d' } });
    session.scenario.apply({
      type: 'env_layer_create',
      payload: { env_id: 'main', layer_id: 'agents', layer_type: 'agent', data: {} },
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

    session.run.start({ actionId: 'step', maxSteps: 2 });
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

    session.run.start({ actionId: 'step', maxSteps: 2 });
    const first = tickId(sent[0]!);
    session.handleIncoming({ type: 'action_end', payload: { id: 'step', tick_id: first, continue: true } });
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
