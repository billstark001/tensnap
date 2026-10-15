import type { ISimulatorTransport } from '@tensnap/core';
import { PROTOCOL_VERSION } from '@tensnap/protocol';
import {
  createBundledExampleTransport,
  type BundledExampleTransportOptions,
  type JsExampleTransportMode,
} from './entries/main-bundle';
import { getJsExampleDefinitions } from './renderers';

export interface JsExampleEntry {
  id: string;
  name: string;
  description: string;
  /** The bundled examples use the strict canonical v0.3 wire contract. */
  protocolVersion: typeof PROTOCOL_VERSION;
  defaultTransportMode: JsExampleTransportMode;
  createTransport: (options?: BundledExampleTransportOptions) => ISimulatorTransport;
}

const jsExampleEntries: JsExampleEntry[] = getJsExampleDefinitions().map((definition) => ({
  id: definition.id,
  name: definition.name,
  description: definition.description,
  protocolVersion: PROTOCOL_VERSION,
  defaultTransportMode: 'inmemory',
  createTransport: (options) => createBundledExampleTransport(definition.id, options),
}));

export function getJsExampleEntries(): JsExampleEntry[] {
  return [...jsExampleEntries];
}
