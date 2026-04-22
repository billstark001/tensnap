import { describe, expect, it } from 'vitest';
import { AgentSession } from './AgentSession';


function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}


describe('AgentSession', () => {
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