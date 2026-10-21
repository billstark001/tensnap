import { describe, expect, it } from 'vitest';
import type { SimulatorToRendererMessage } from '@tensnap/protocol';
import { getJsExampleDefinition, type JsExampleDefinition } from '../renderers';
import { createSchellingExample } from '../renderers/schelling';
import { SchellingModel, DEFAULT_SCHELLING_CONFIG } from './schelling';
import { runSchellingTrial } from '../standalone/schelling-study';

const config = {
  width: 8,
  height: 7,
  gridWidth: 8,
  gridHeight: 7,
  numFeatures: 3,
  numTraits: 4,
  updatesPerTick: 5,
  initialNumberSheep: 12,
  initialNumberWolves: 4,
  seed: 7,
};

async function open(definition: JsExampleDefinition, id: string) {
  const messages: SimulatorToRendererMessage[] = [];
  const session = definition.createSession(config);
  session.attach((message) => {
    messages.push(message);
  }, id);
  await session.open(id);
  const sync = async () => {
    messages.length = 0;
    await session.dispatch({
      type: 'state_sync',
      payload: {
        request_id: id,
        model_id: definition.id,
        parameters: [],
        actions: [],
        envs: [],
        charts: [],
        monitors: [],
      },
    });
    return structuredClone(
      messages.filter((message) =>
        ['item_create', 'metadata_update', 'monitor_update'].includes(message.type),
      ),
    );
  };
  const step = () =>
    session.dispatch({ type: 'action_invoke', payload: { id: 'step', request_id: `${id}-step` } });
  return { session, sync, step };
}

describe('model-owned randomness', () => {
  it.each(['schelling', 'axelrod', 'tornberg', 'wolf-sheep'])(
    '%s is seeded and independent of other sessions and repeated observations',
    async (id) => {
      const left = await open(getJsExampleDefinition(id), `${id}-left`);
      const right = await open(getJsExampleDefinition(id), `${id}-right`);
      const other = await open(getJsExampleDefinition(id), `${id}-other`);
      try {
        for (let tick = 0; tick < 4; tick++) {
          const initial = await left.sync();
          expect(await left.sync()).toEqual(initial);
          expect(await right.sync()).toEqual(initial);
          await left.step();
          await other.step();
          await other.sync();
          await right.step();
        }
        expect(await left.sync()).toEqual(await right.sync());
        await left.session.dispatch({
          type: 'action_invoke',
          payload: { id: 'reset', request_id: 'reset' },
        });
        const fresh = await open(getJsExampleDefinition(id), `${id}-fresh`);
        try {
          expect(await left.sync()).toEqual(await fresh.sync());
        } finally {
          await fresh.session.close();
        }
      } finally {
        await left.session.close();
        await right.session.close();
        await other.session.close();
      }
    },
  );

  it('keeps observers local to their definition and session lifetime', async () => {
    let a = 0,
      b = 0;
    const left = await open(
      createSchellingExample(() => a++),
      'observe-a',
    );
    const right = await open(
      createSchellingExample(() => b++),
      'observe-b',
    );
    const plain = await open(getJsExampleDefinition('schelling'), 'observe-plain');
    try {
      const previousB = b;
      await left.step();
      expect(b).toBe(previousB);
      const previousA = a;
      await plain.step();
      expect(a).toBe(previousA);
      await right.step();
      expect(a).toBe(previousA);
      expect(b).toBeGreaterThan(previousB);
    } finally {
      await left.session.close();
      await right.session.close();
      await plain.session.close();
    }
  });

  it('applies seed edits only on initialization and preserves the pending seed in a checkpoint', () => {
    const model = new SchellingModel({
      ...DEFAULT_SCHELLING_CONFIG,
      gridWidth: 8,
      gridHeight: 7,
      seed: 7,
    });
    model.initialize();
    model.step();
    const saved = model.captureCheckpointData() as Record<string, unknown>;
    model.updateConfig({ seed: 8 });
    expect(model.captureCheckpointData()).toMatchObject({
      rngState: saved.rngState,
      agents: saved.agents,
    });
    const pending = model.captureCheckpointData();
    model.reset();
    const fresh = new SchellingModel({
      ...DEFAULT_SCHELLING_CONFIG,
      gridWidth: 8,
      gridHeight: 7,
      seed: 8,
    });
    fresh.initialize();
    expect(model.captureCheckpointData()).toEqual(fresh.captureCheckpointData());
    model.restoreCheckpointData(pending);
    expect(model.getConfig().seed).toBe(8);
    expect(model.captureCheckpointData()).toEqual(pending);
    const bad = structuredClone(pending) as Record<string, unknown>;
    bad.unsatisfiedIds = ['missing'];
    expect(() => model.restoreCheckpointData(bad)).toThrow();
    expect(model.captureCheckpointData()).toEqual(pending);
  });

  it('distinguishes a jammed full grid from a satisfied configuration', () => {
    expect(
      runSchellingTrial(
        {
          ...DEFAULT_SCHELLING_CONFIG,
          gridWidth: 5,
          gridHeight: 5,
          density: 1,
          similarityThreshold: 1,
        },
        10,
        'convergence',
      ).termination,
    ).toBe('jammed');
    expect(
      runSchellingTrial({ ...DEFAULT_SCHELLING_CONFIG, similarityThreshold: 0 }, 10, 'convergence')
        .termination,
    ).toBe('satisfied');
  });
});
