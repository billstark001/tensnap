import { describe, expect, it } from 'vitest';
import { RendererSession } from '@tensnap/core/runtime';
import { WebSocketManagerImpl } from './impl';

describe('WebSocketManagerImpl', () => {
  it('fails a disconnected send so optimistic parameter state rolls back', () => {
    const transport = new WebSocketManagerImpl(null, 'ws://127.0.0.1:1');
    const session = new RendererSession();
    session.attachTransport(transport);
    session.handleIncoming({
      type: 'simulator_info',
      payload: {
        protocol_version: '0.3',
        binding: { name: 'test', version: '0.3.0' },
        model: { id: 'test-model' },
        instance_id: 'test-instance',
        capabilities: [],
      },
    });
    session.scenario.apply({
      type: 'param_create',
      payload: {
        id: 'speed',
        type: 'number',
        label: 'Speed',
        value: 1,
      },
    });

    expect(() => session.setParameter('speed', 2)).toThrow(/not connected/);
    expect(session.scenario.parameters.get('speed')?.value).toBe(1);
    session.destroy();
  });
});
