import { getJsExampleEntries } from '@tensnap/examples-js';
import type { BenchmarkCase } from '../types';
import { createWebScenarioCase } from './createWebScenarioCase';

const SCHELLING_ENTRY = getJsExampleEntries().find((entry) => entry.id === 'schelling');
if (!SCHELLING_ENTRY) throw new Error('The bundled Schelling web example is not registered.');
const createSchellingTransport = SCHELLING_ENTRY.createTransport;

export function createSchellingScenarioCase(partial: Record<string, unknown> = {}): BenchmarkCase {
  const modelConfig = {
    gridWidth: (partial.gridWidth as number) ?? 40,
    gridHeight: (partial.gridHeight as number) ?? 40,
    similarityThreshold: (partial.similarityThreshold as number) ?? 0.7,
    density: (partial.density as number) ?? 0.8,
    balance: (partial.balance as number) ?? 0.5,
  };
  const width = (partial.previewWidth as number) ?? 1000;
  const height = (partial.previewHeight as number) ?? 760;
  return createWebScenarioCase({
    name: 'Schelling Segregation Model',
    config: { ...modelConfig, previewWidth: width, previewHeight: height },
    width,
    height,
    createTransport: () => createSchellingTransport({ config: modelConfig }),
  });
}

export const schellingScenarioVariations = [
  createSchellingScenarioCase({ gridWidth: 30, gridHeight: 30, density: 0.89 }),
  createSchellingScenarioCase({ gridWidth: 40, gridHeight: 40, density: 0.88 }),
  createSchellingScenarioCase({ gridWidth: 80, gridHeight: 80, similarityThreshold: 1, density: 0.78 }),
  createSchellingScenarioCase({ gridWidth: 120, gridHeight: 120, similarityThreshold: 1, density: 0.81 }),
];
