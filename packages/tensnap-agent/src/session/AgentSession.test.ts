import { describe, expect, it, vi } from 'vitest';
import type { RendererToSimulatorMessage } from '@tensnap/protocol';
import { AgentSession } from './AgentSession';


function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}


describe('AgentSession', () => {
  it('re-dispatches continuous actions only after render completion is acknowledged', () => {
    const session = new AgentSession();
    const sent: RendererToSimulatorMessage[] = [];

    (session as any).transport = {
      send: (message: RendererToSimulatorMessage) => {
        sent.push(message);
      },
      destroy: vi.fn(),
      disconnect: vi.fn(),
      isConnected: true,
    };

    session.runAction('start', true);

    expect(sent).toHaveLength(1);
    const firstTickId = sent[0]?.payload && typeof sent[0].payload === 'object' && 'tick_id' in sent[0].payload
      && typeof sent[0].payload.tick_id === 'string'
      ? sent[0].payload.tick_id
      : undefined;

    (session as any).handleMessage({
      type: 'action_end',
      payload: {
        id: 'start',
        tick_id: firstTickId,
        continue: true,
      },
    });

    expect(sent).toHaveLength(1);

    session.markActionRendered({ id: 'start', tick_id: firstTickId });

    expect(sent).toHaveLength(2);
  });

  it('holds queued actions until the requested state sync completes', () => {
    const session = new AgentSession();
    const sent: RendererToSimulatorMessage[] = [];

    (session as any).transport = {
      send: (message: RendererToSimulatorMessage) => {
        sent.push(message);
      },
      destroy: vi.fn(),
      disconnect: vi.fn(),
      isConnected: true,
    };

    session.requestStateSync();
    session.runAction('step', false);

    expect(sent).toHaveLength(1);
    const syncRequestId = sent[0]?.payload && typeof sent[0].payload === 'object' && 'request_id' in sent[0].payload
      ? sent[0].payload.request_id
      : undefined;

    (session as any).handleMessage({
      type: 'state_sync_begin',
      payload: {
        request_id: syncRequestId,
      },
    });
    (session as any).handleMessage({
      type: 'state_sync_end',
      payload: {
        request_id: syncRequestId,
      },
    });

    expect(sent).toHaveLength(2);
    expect(sent[1]?.type).toBe('action_start');
  });

  it('exposes merged chart series for agent consumption', () => {
    const session = new AgentSession();

    session.scenario.apply({
      type: 'chart_create',
      payload: { id: 'alive', label: 'Alive', color: '#22c55e' },
    });
    session.scenario.apply({
      type: 'chart_update',
      payload: {
        updates: [
          { id: 'alive', time: 1, value: 3 },
          { id: 'alive', time: 2, value: 5 },
        ],
      },
    });

    expect(session.listChartSeries()).toEqual([
      {
        id: 'alive',
        metadata: { id: 'alive', label: 'Alive', color: '#22c55e' },
        points: [
          { time: 1, alive: 3 },
          { time: 2, alive: 5 },
        ],
      },
    ]);
    expect(session.getChartSeries('alive')?.points).toHaveLength(2);
  });

  it('summarizes resolved assets in the scene summary', async () => {
    const session = new AgentSession();

    session.scenario.apply({
      type: 'asset_meta',
      payload: {
        assets: [
          { id: 'config', hash: 'h1', mime: 'application/json', size: 11, label: 'Config' },
        ],
      },
    });
    session.scenario.apply({
      type: 'asset_data',
      payload: {
        id: 'config',
        hash: 'h1',
        mime: 'application/json',
        data: 'data:application/json;base64,eyJvayI6dHJ1ZX0=',
      },
    });
    await flushAsyncWork();

    expect(session.listAssets()).toEqual([
      {
        id: 'config',
        hash: 'h1',
        mime: 'application/json',
        size: 11,
        label: 'Config',
        resolved: true,
        valueType: 'string',
      },
    ]);
    expect(session.getSceneSummary().assets[0]?.id).toBe('config');
  });
});