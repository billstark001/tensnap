import type { ISimulatorTransport } from '@tensnap/core';
import { createPostMessageSimulatorHost } from '@tensnap/js/transport';
import { InMemoryTransport, createLinkedEndpoints, createPostMessageTransport } from '@tensnap/web-adapter/transport';
import { getJsExampleDefinition } from '../renderers';
import { createSessionFromSimulationHandler } from '../runtime';

export type JsExampleTransportMode = 'inmemory' | 'postmessage';

export interface BundledExampleTransportOptions {
  mode?: JsExampleTransportMode;
  config?: unknown;
  connectionId?: string;
}

export function createBundledExampleTransport(
  id: string,
  options: BundledExampleTransportOptions = {},
): ISimulatorTransport {
  const definition = getJsExampleDefinition(id);
  const handler = definition.createHandler(options.config);
  const mode = options.mode ?? 'inmemory';

  if (mode === 'inmemory') {
    return new InMemoryTransport(handler, options.connectionId ?? handler.connectionId);
  }

  const { renderer, simulator } = createLinkedEndpoints();
  const connectionId = options.connectionId ?? handler.connectionId;
  const host = createPostMessageSimulatorHost({
    endpoint: simulator,
    session: createSessionFromSimulationHandler(handler),
    connectionId,
  });
  const transport = createPostMessageTransport({
    endpoint: renderer,
    connectionId,
  });
  const originalDestroy = transport.destroy.bind(transport);
  transport.destroy = () => {
    originalDestroy();
    void host.destroy();
  };
  return transport;
}