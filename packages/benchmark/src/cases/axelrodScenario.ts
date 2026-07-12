import { getJsExampleEntries } from '@tensnap/examples-js';
import type { AxelrodConfig } from '@tensnap/examples-js/models';
import type { BenchmarkCase } from '../types';
import { createWebScenarioCase } from './createWebScenarioCase';

const entry = getJsExampleEntries().find((candidate) => candidate.id === 'axelrod');
if (!entry) throw new Error('The bundled Axelrod web example is not registered.');
const createTransport = entry.createTransport;

export function createAxelrodScenarioCase(partial: Partial<AxelrodConfig> = {}): BenchmarkCase {
  const modelConfig: AxelrodConfig = {
    width: partial.width ?? 40,
    height: partial.height ?? 40,
    numFeatures: partial.numFeatures ?? 8,
    numTraits: partial.numTraits ?? 10,
    neighborhood: partial.neighborhood ?? 'moore',
    updatesPerTick: partial.updatesPerTick ?? 200,
  };
  return createWebScenarioCase({
    name: 'Axelrod Cultural Dissemination',
    config: { ...modelConfig, previewWidth: 1000, previewHeight: 760 },
    width: 1000,
    height: 760,
    createTransport: () => createTransport({ config: modelConfig }),
  });
}

export const axelrodScenarioVariations = [
  createAxelrodScenarioCase({ width: 25, height: 25, updatesPerTick: 100 }),
  createAxelrodScenarioCase({ width: 40, height: 40, updatesPerTick: 200 }),
  createAxelrodScenarioCase({ width: 70, height: 70, updatesPerTick: 500 }),
];
