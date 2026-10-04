import { describe, expect, it } from 'vitest';
import { SchellingModel } from './schelling';

function checkpointFor(seed: number): unknown {
  const model = new SchellingModel({
    gridWidth: 20,
    gridHeight: 20,
    density: 0.8,
    balance: 0.5,
    similarityThreshold: 0.7,
    seed,
  });
  model.initialize();
  model.step();
  model.step();
  return model.captureCheckpointData();
}

describe('SchellingModel seed', () => {
  it('replays a seeded model without exposing the seed as a UI parameter', () => {
    expect(checkpointFor(20260718)).toEqual(checkpointFor(20260718));
    expect(
      new SchellingModel({
        gridWidth: 20,
        gridHeight: 20,
        density: 0.8,
        balance: 0.5,
        similarityThreshold: 0.7,
        seed: 20260718,
      }).getConfig(),
    ).not.toHaveProperty('seed');
  });

  it.each([7, undefined])(
    'replays the next stochastic step after checkpoint restore (seed %s)',
    (seed) => {
      const model = new SchellingModel({
        gridWidth: 10,
        gridHeight: 10,
        density: 0.8,
        balance: 0.5,
        similarityThreshold: 0.7,
        seed,
      });
      model.initialize();
      for (let index = 0; index < 3; index += 1) model.step();
      const checkpoint = model.captureCheckpointData();
      model.step();
      const advanced = model.getEnvironmentState();
      const advancedStatistics = model.getStatistics();
      model.restoreCheckpointData(checkpoint);
      model.step();
      expect(model.getEnvironmentState()).toEqual(advanced);
      expect(model.getStatistics()).toEqual(advancedStatistics);
    },
  );
});
