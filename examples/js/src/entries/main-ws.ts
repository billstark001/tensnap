import type { ProtocolEncoding } from '@tensnap/core';
import { createWebSocketTransportHost } from '@tensnap/js/transport';
import { getJsExampleDefinition } from '../renderers';
import { createSessionFromSimulationHandler } from '../runtime';

export interface StartJsExampleWebSocketDemoOptions {
  port?: number;
  encoding?: ProtocolEncoding;
  config?: unknown;
}

export interface RunningJsExampleDemo {
  id: string;
  name: string;
  url?: string;
  stop(): Promise<void>;
}

export async function startJsExampleWebSocketDemo(
  id: string,
  options: StartJsExampleWebSocketDemoOptions = {},
): Promise<RunningJsExampleDemo> {
  const definition = getJsExampleDefinition(id);
  const host = createWebSocketTransportHost({
    serverOptions: { port: options.port ?? 8765 },
    encoding: options.encoding ?? 'json',
    sessionFactory: () => createSessionFromSimulationHandler(definition.createHandler(options.config)),
  });

  return {
    id: definition.id,
    name: definition.name,
    url: host.url,
    stop: () => host.close(),
  };
}

function parseCliArgs(argv: string[]): { id: string; port?: number } {
  const [id = 'schelling', ...rest] = argv;
  const portArg = rest.find((arg) => arg.startsWith('--port='));
  return {
    id,
    port: portArg ? Number(portArg.slice('--port='.length)) : undefined,
  };
}

async function main(): Promise<void> {
  const { id, port } = parseCliArgs(process.argv.slice(2));
  const demo = await startJsExampleWebSocketDemo(id, { port });
  console.log(`Started ${demo.name} at ${demo.url ?? 'unknown url'}`);
}

const currentModulePath = decodeURIComponent(new URL(import.meta.url).pathname);

if (process.argv[1] && currentModulePath === process.argv[1]) {
  void main();
}