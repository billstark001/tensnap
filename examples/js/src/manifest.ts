import type { ISimulatorTransport } from '@tensnap/core';
import {
  createBundledExampleTransport,
  type BundledExampleTransportOptions,
  type JsExampleTransportMode,
} from './entries/main-bundle';
import {
  type RunningJsExampleDemo,
  type StartJsExampleWebSocketDemoOptions,
} from './entries/main-ws';
import { getJsExampleDefinitions } from './renderers';

export interface JsExampleEntry {
  id: string;
  name: string;
  description: string;
  defaultTransportMode: JsExampleTransportMode;
  createTransport: (options?: BundledExampleTransportOptions) => ISimulatorTransport;
  startDemoServer: (options?: StartJsExampleWebSocketDemoOptions) => Promise<RunningJsExampleDemo>;
}

const jsExampleEntries: JsExampleEntry[] = getJsExampleDefinitions().map((definition) => ({
  id: definition.id,
  name: definition.name,
  description: definition.description,
  defaultTransportMode: 'inmemory',
  createTransport: (options) => createBundledExampleTransport(definition.id, options),
  startDemoServer: async (options) => {
    const { startJsExampleWebSocketDemo } = await import('./entries/main-ws');
    return startJsExampleWebSocketDemo(definition.id, options);
  },
}));

export function getJsExampleEntries(): JsExampleEntry[] {
  return [...jsExampleEntries];
}