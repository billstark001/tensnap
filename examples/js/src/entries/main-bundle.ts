import type { ISimulatorTransport } from '@tensnap/core';
import {
  createLinkedEndpoints,
  createPostMessageSimulatorHost,
  generateConnectionId,
} from '@tensnap/js/transport';
import { createPostMessageTransport } from '@tensnap/web-adapter/transport';
import { getJsExampleDefinition } from '../renderers';

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
  const mode = options.mode ?? 'inmemory';
  const { renderer, simulator } = createLinkedEndpoints();
  const connectionId = options.connectionId ?? generateConnectionId(`example-${mode}`);
  const host = createPostMessageSimulatorHost({
    endpoint: simulator,
    session: definition.createSession(options.config),
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