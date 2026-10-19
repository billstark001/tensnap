export * from './impl';
export * from './errors';
export * from './constants';
export * from './registry';

import { getJsExampleEntries } from '@tensnap/examples-js';
import { registerBuiltinModels } from './registry';
export function registerDefaultModels(): void {
  registerBuiltinModels(
    getJsExampleEntries().map((entry) => ({
      id: entry.id,
      name: entry.name,
      description: entry.description,
      protocolVersion: entry.protocolVersion,
      create: entry.createTransport,
    })),
  );
}
