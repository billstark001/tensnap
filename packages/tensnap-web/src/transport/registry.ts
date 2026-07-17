import type { ISimulatorTransport } from '@tensnap/core';

export interface BuiltinTransportModel {
  id: string;
  name: string;
  description: string;
  protocolVersion?: string;
  create: () => ISimulatorTransport;
}

const modelFactories = new Map<string, BuiltinTransportModel>();
const INMEMORY_PREFIX = 'inmemory:';

export function registerBuiltinModel(model: BuiltinTransportModel): void {
  modelFactories.set(model.id, model);
}

export function registerBuiltinModels(models: BuiltinTransportModel[]): void {
  models.forEach(registerBuiltinModel);
}

export function listBuiltinModels(): BuiltinTransportModel[] {
  return Array.from(modelFactories.values());
}

export function resolveTransport(input: string): ISimulatorTransport | null {
  if (!input.startsWith(INMEMORY_PREFIX)) {
    return null;
  }
  const id = input.slice(INMEMORY_PREFIX.length);
  const model = modelFactories.get(id);
  return model ? model.create() : null;
}

export function isInMemoryConnectionId(input: string): boolean {
  return input.startsWith(INMEMORY_PREFIX);
}

export function makeInMemoryConnectionId(id: string): string {
  return `${INMEMORY_PREFIX}${id}`;
}
