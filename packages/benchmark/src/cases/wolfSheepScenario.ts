import { getJsExampleEntries } from '@tensnap/examples-js';
import type { WolfSheepConfig } from '@tensnap/examples-js/models';
import type { BenchmarkCase } from '../types';
import { createWebScenarioCase } from './createWebScenarioCase';

const WOLF_SHEEP_ENTRY = getJsExampleEntries().find((entry) => entry.id === 'wolf-sheep');
if (!WOLF_SHEEP_ENTRY) throw new Error('The bundled Wolf-Sheep web example is not registered.');
const createWolfSheepTransport = WOLF_SHEEP_ENTRY.createTransport;

export function createWolfSheepScenarioCase(partial: Record<string, unknown> = {}): BenchmarkCase {
  const modelConfig: WolfSheepConfig = {
    modelVersion: (partial.modelVersion as WolfSheepConfig['modelVersion']) ?? 'sheep-wolves-grass',
    initialNumberSheep: (partial.initialNumberSheep as number) ?? 100,
    initialNumberWolves: (partial.initialNumberWolves as number) ?? 50,
    sheepGainFromFood: (partial.sheepGainFromFood as number) ?? 4,
    wolfGainFromFood: (partial.wolfGainFromFood as number) ?? 20,
    grassRegrowthTime: (partial.grassRegrowthTime as number) ?? 30,
    sheepReproduce: (partial.sheepReproduce as number) ?? 4,
    wolfReproduce: (partial.wolfReproduce as number) ?? 5,
    showEnergy: (partial.showEnergy as boolean) ?? false,
    gridWidth: (partial.gridWidth as number) ?? 50,
    gridHeight: (partial.gridHeight as number) ?? 50,
  };
  const width = (partial.previewWidth as number) ?? 1000;
  const height = (partial.previewHeight as number) ?? 760;
  return createWebScenarioCase({
    name: 'Wolf-Sheep Predation Model',
    config: { ...modelConfig, previewWidth: width, previewHeight: height },
    width,
    height,
    createTransport: () => createWolfSheepTransport({ config: modelConfig }),
  });
}

export const wolfSheepScenarioVariations = [
  createWolfSheepScenarioCase({ gridWidth: 30, gridHeight: 30, initialNumberSheep: 50, initialNumberWolves: 25 }),
  createWolfSheepScenarioCase({ gridWidth: 50, gridHeight: 50, initialNumberSheep: 400, initialNumberWolves: 150 }),
  createWolfSheepScenarioCase({ gridWidth: 100, gridHeight: 100, initialNumberSheep: 800, initialNumberWolves: 400, grassRegrowthTime: 25 }),
];
