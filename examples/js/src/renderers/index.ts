import type { SimulatorSession } from '@tensnap/js/runtime';
import type { ScenarioDefinition } from '@tensnap/js/scenario';
import {
  AXELROD_EXAMPLE,
} from './axelrod';
import {
  SCHELLING_EXAMPLE,
} from './schelling';
import {
  TORNBERG_EXAMPLE,
} from './tornberg';
import type { JsExampleMetadata } from './shared';
import {
  WOLF_SHEEP_EXAMPLE,
} from './wolf-sheep';

export * from './axelrod';
export * from './schelling';
export * from './tornberg';
export * from './wolf-sheep';
export type { JsExampleMetadata } from './shared';

export interface JsExampleDefinition extends JsExampleMetadata {
  createScenario(config?: unknown): ScenarioDefinition;
  createSession(config?: unknown): SimulatorSession;
}

const jsExampleDefinitions: JsExampleDefinition[] = [
  SCHELLING_EXAMPLE,
  WOLF_SHEEP_EXAMPLE,
  AXELROD_EXAMPLE,
  TORNBERG_EXAMPLE,
];

export function getJsExampleDefinitions(): JsExampleDefinition[] {
  return [...jsExampleDefinitions];
}

export function getJsExampleDefinition(id: string): JsExampleDefinition {
  const definition = jsExampleDefinitions.find((entry) => entry.id === id);
  if (!definition) {
    throw new Error(`Unknown JS example: ${id}`);
  }
  return definition;
}