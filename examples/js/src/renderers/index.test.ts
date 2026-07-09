import type { SimulatorToRendererMessage, StateSyncRequest } from '@tensnap/protocol';
import { describe, expect, it } from 'vitest';
import { getJsExampleDefinition, getJsExampleDefinitions } from './index';

const emptyStateSync: StateSyncRequest = {
  parameters: [],
  actions: [],
  envs: [],
  charts: [],
};

describe('JS example sessions', () => {
  for (const definition of getJsExampleDefinitions()) {
    it(`${definition.id} opens, syncs, and steps through @tensnap/js`, async () => {
      const messages: SimulatorToRendererMessage[] = [];
      const session = definition.createSession();
      session.attach((message) => {
        messages.push(message);
      }, `test-${definition.id}`);

      await session.open(`test-${definition.id}`);

      expect(messages.some((message) => message.type === 'env_create')).toBe(true);
      expect(messages.some((message) => message.type === 'item_create')).toBe(true);

      messages.length = 0;
      await session.dispatch({ type: 'state_sync', payload: emptyStateSync });

      expect(messages.some((message) => message.type === 'state_sync_begin')).toBe(true);
      expect(messages.some((message) => message.type === 'action_create')).toBe(true);
      expect(messages.some((message) => message.type === 'chart_create')).toBe(true);
      expect(messages.some((message) => message.type === 'state_sync_end')).toBe(true);

      messages.length = 0;
      await session.dispatch({ type: 'action_start', payload: { id: 'step' } });

      expect(messages.some((message) => message.type === 'metadata_update')).toBe(true);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'action_end',
          payload: expect.objectContaining({ id: 'step' }),
        }),
      );

      await session.close();
    });
  }

  it('accepted runtime parameter changes do not echo param_update for schelling', async () => {
    const messages: SimulatorToRendererMessage[] = [];
    const session = getJsExampleDefinition('schelling').createSession();
    session.attach((message) => {
      messages.push(message);
    }, 'test-schelling-param-change');

    await session.open('test-schelling-param-change');

    messages.length = 0;
    await session.dispatch({
      type: 'param_change',
      payload: { id: 'similarityThreshold', value: 0.55 },
    });

    expect(messages.some((message) => message.type === 'param_update')).toBe(false);

    await session.close();
  });

  it('accepted runtime parameter changes do not echo param_update for wolf-sheep', async () => {
    const messages: SimulatorToRendererMessage[] = [];
    const session = getJsExampleDefinition('wolf-sheep').createSession();
    session.attach((message) => {
      messages.push(message);
    }, 'test-wolf-sheep-param-change');

    await session.open('test-wolf-sheep-param-change');

    messages.length = 0;
    await session.dispatch({
      type: 'param_change',
      payload: { id: 'showEnergy', value: true },
    });

    expect(messages.some((message) => message.type === 'param_update')).toBe(false);

    await session.close();
  });
});
