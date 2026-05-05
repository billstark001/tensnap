import type { SimulatorSession } from '@tensnap/js/runtime';
import type { ScenarioDefinition } from '@tensnap/js/scenario';
import {
  AXELROD_METADATA,
  createAxelrodScenario,
  createAxelrodSession,
} from './axelrod';
import {
  createSchellingScenario,
  createSchellingSession,
  SCHELLING_METADATA,
} from './schelling';
import {
  createTornbergScenario,
  createTornbergSession,
  TORNBERG_METADATA,
} from './tornberg';
import type { JsExampleMetadata } from './shared';
import {
  createWolfSheepScenario,
  createWolfSheepSession,
  WOLF_SHEEP_METADATA,
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
  {
    ...SCHELLING_METADATA,
    createScenario(config) {
      return createSchellingScenario((config ?? {}) as Parameters<typeof createSchellingScenario>[0]);
    },
    createSession(config) {
      return createSchellingSession((config ?? {}) as Parameters<typeof createSchellingSession>[0]);
    },
  },
  {
    ...WOLF_SHEEP_METADATA,
    createScenario(config) {
      return createWolfSheepScenario((config ?? {}) as Parameters<typeof createWolfSheepScenario>[0]);
    },
    createSession(config) {
      return createWolfSheepSession((config ?? {}) as Parameters<typeof createWolfSheepSession>[0]);
    },
  },
  {
    ...AXELROD_METADATA,
    createScenario(config) {
      return createAxelrodScenario((config ?? {}) as Parameters<typeof createAxelrodScenario>[0]);
    },
    createSession(config) {
      return createAxelrodSession((config ?? {}) as Parameters<typeof createAxelrodSession>[0]);
    },
  },
  {
    ...TORNBERG_METADATA,
    createScenario(config) {
      return createTornbergScenario((config ?? {}) as Parameters<typeof createTornbergScenario>[0]);
    },
    createSession(config) {
      return createTornbergSession((config ?? {}) as Parameters<typeof createTornbergSession>[0]);
    },
  },
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