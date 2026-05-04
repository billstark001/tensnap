import type { ISimulatorTransport } from '@tensnap/core';

export interface JsExampleEntry {
  id: string;
  name: string;
  description: string;
  createTransport: () => ISimulatorTransport;
}

const jsExampleEntries: JsExampleEntry[] = [];

export function getJsExampleEntries(): JsExampleEntry[] {
  return [...jsExampleEntries];
}