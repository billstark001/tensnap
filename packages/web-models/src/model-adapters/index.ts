import { InMemoryTransport } from '@tensnap/web-adapter/transport';
import { createAxelrodAdapter } from './axelrod-adapter';
import { createSchellingAdapter } from './schelling-adapter';
import { createTornbergAdapter } from './tornberg-adapter';
import { createWolfSheepAdapter } from './wolf-sheep-adapter';

export * from './base-adapter';
export * from './axelrod-adapter';
export * from './schelling-adapter';
export * from './tornberg-adapter';
export * from './wolf-sheep-adapter';

export interface BuiltinModelEntry {
  id: string;
  name: string;
  description: string;
  createTransport: () => InMemoryTransport;
}

export function getBuiltinModelEntries(): BuiltinModelEntry[] {
  return [
    {
      id: 'schelling',
      name: 'Schelling Segregation',
      description: 'Neighbor similarity preferences produce segregation patterns.',
      createTransport: () => new InMemoryTransport(createSchellingAdapter()),
    },
    {
      id: 'wolf-sheep',
      name: 'Wolf-Sheep Predation',
      description: 'Predator-prey ecosystem with grass regrowth.',
      createTransport: () => new InMemoryTransport(createWolfSheepAdapter()),
    },
    {
      id: 'axelrod',
      name: 'Axelrod Culture Dissemination',
      description: 'Cultural convergence and polarization over a grid network.',
      createTransport: () => new InMemoryTransport(createAxelrodAdapter()),
    },
    {
      id: 'tornberg',
      name: 'Tornberg Partisan Sorting',
      description: 'Partisan-weighted influence with digital-media reach.',
      createTransport: () => new InMemoryTransport(createTornbergAdapter()),
    },
  ];
}
