import type { InMemorySimulationHandler } from '@tensnap/web-adapter/transport';
import { createAxelrodAdapter, AXELROD_METADATA } from './axelrod';
import { createSchellingAdapter, SCHELLING_METADATA } from './schelling';
import { createTornbergAdapter, TORNBERG_METADATA } from './tornberg';
import { createWolfSheepAdapter, WOLF_SHEEP_METADATA } from './wolf-sheep';

export * from './axelrod';
export * from './schelling';
export * from './tornberg';
export * from './wolf-sheep';

export interface JsExampleDefinition {
  id: string;
  name: string;
  description: string;
  createHandler(config?: unknown): InMemorySimulationHandler;
}

const jsExampleDefinitions: JsExampleDefinition[] = [
  {
    ...SCHELLING_METADATA,
    createHandler(config) {
      return createSchellingAdapter((config ?? {}) as Parameters<typeof createSchellingAdapter>[0]);
    },
  },
  {
    ...WOLF_SHEEP_METADATA,
    createHandler(config) {
      return createWolfSheepAdapter((config ?? {}) as Parameters<typeof createWolfSheepAdapter>[0]);
    },
  },
  {
    ...AXELROD_METADATA,
    createHandler(config) {
      return createAxelrodAdapter((config ?? {}) as Parameters<typeof createAxelrodAdapter>[0]);
    },
  },
  {
    ...TORNBERG_METADATA,
    createHandler(config) {
      return createTornbergAdapter((config ?? {}) as Parameters<typeof createTornbergAdapter>[0]);
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