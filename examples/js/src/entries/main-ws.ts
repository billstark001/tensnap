import type { ProtocolEncoding } from '@tensnap/protocol';
import { createWebSocketTransportHost } from '@tensnap/js/transport';
import type { SchellingConfig } from '../models/schelling';
import { getJsExampleDefinition } from '../renderers';

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
    sessionFactory: () => definition.createSession(options.config),
  });

  return {
    id: definition.id,
    name: definition.name,
    url: host.url,
    stop: () => host.close(),
  };
}

interface CliArgs {
  id: string;
  port?: number;
  encoding?: ProtocolEncoding;
}

function parseCliArgs(argv: string[]): CliArgs {
  const [id = 'schelling', ...rest] = argv;
  const portArg = rest.find((arg) => arg.startsWith('--port='));
  const encodingArg = rest.find((arg) => arg.startsWith('--encoding='));
  const encoding = encodingArg?.slice('--encoding='.length);
  if (encoding !== undefined && encoding !== 'json' && encoding !== 'msgpack') {
    throw new Error('--encoding must be json or msgpack.');
  }
  const port = portArg ? Number(portArg.slice('--port='.length)) : undefined;
  if (port !== undefined && (!Number.isInteger(port) || port <= 0 || port > 65_535)) {
    throw new Error('--port must be an integer from 1 through 65535.');
  }
  return {
    id,
    port,
    encoding,
  };
}

function optionalNumberEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number.`);
  return value;
}

/** Keep benchmark configuration in the process environment, not in UI parameters. */
function schellingConfigFromEnv(): Partial<SchellingConfig> {
  const config: Partial<SchellingConfig> = {};
  const environmentFields: ReadonlyArray<readonly [keyof SchellingConfig, string]> = [
    ['gridWidth', 'TENSNAP_SCHELLING_WIDTH'],
    ['gridHeight', 'TENSNAP_SCHELLING_HEIGHT'],
    ['density', 'TENSNAP_SCHELLING_DENSITY'],
    ['balance', 'TENSNAP_SCHELLING_BALANCE'],
    ['similarityThreshold', 'TENSNAP_SCHELLING_THRESHOLD'],
    ['seed', 'TENSNAP_SCHELLING_SEED'],
  ];
  for (const [field, environmentName] of environmentFields) {
    const value = optionalNumberEnv(environmentName);
    if (value !== undefined) config[field] = value;
  }
  return config;
}

async function main(): Promise<void> {
  const { id, port, encoding } = parseCliArgs(process.argv.slice(2));
  const config = id === 'schelling' ? schellingConfigFromEnv() : undefined;
  const demo = await startJsExampleWebSocketDemo(id, { port, encoding, config });
  console.log(`Started ${demo.name} at ${demo.url ?? 'unknown url'}`);
}

const currentModulePath = decodeURIComponent(new URL(import.meta.url).pathname);

if (process.argv[1] && currentModulePath === process.argv[1]) {
  void main();
}
