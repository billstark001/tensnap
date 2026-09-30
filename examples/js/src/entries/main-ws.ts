// This production example host is reusable by the thin benchmark server
// adapter. Keeping the launcher separate avoids a second binding/session path;
// ordinary applications may combine these responsibilities.
import type { ProtocolEncoding } from '@tensnap/protocol';
import { createWebSocketTransportHost } from '@tensnap/js/transport';
import { DEFAULT_SCHELLING_CONFIG, type SchellingConfig } from '../models/schelling';
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
  config?: SchellingConfig;
}

function parseCliArgs(argv: string[]): CliArgs {
  const [first, ...tail] = argv;
  const id = first === undefined || first.startsWith('--') ? 'schelling' : first;
  const rest = id === first ? tail : argv;
  const values = new Map<string, string>();
  const allowed = new Set(['port', 'encoding', 'width', 'height', 'density', 'balance', 'threshold', 'seed']);
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index]!;
    if (!argument.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`);
    const equalsAt = argument.indexOf('=');
    const name = argument.slice(2, equalsAt >= 0 ? equalsAt : undefined);
    if (!allowed.has(name)) throw new Error(`Unknown option: --${name}`);
    const value = equalsAt >= 0 ? argument.slice(equalsAt + 1) : rest[++index];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name} requires a value.`);
    values.set(name, value);
  }

  const encoding = values.get('encoding');
  if (encoding !== undefined && encoding !== 'json' && encoding !== 'msgpack') {
    throw new Error('--encoding must be json or msgpack.');
  }
  const port = values.has('port') ? Number(values.get('port')) : undefined;
  if (port !== undefined && (!Number.isInteger(port) || port <= 0 || port > 65_535)) {
    throw new Error('--port must be an integer from 1 through 65535.');
  }

  const modelOptions = ['width', 'height', 'density', 'balance', 'threshold', 'seed']
    .filter((name) => values.has(name));
  if (id !== 'schelling' && modelOptions.length > 0) {
    throw new Error(`Schelling options cannot be used with the ${id} example.`);
  }
  const finite = (name: string, fallback: number): number => {
    const raw = values.get(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`--${name} must be a finite number.`);
    return value;
  };
  const width = finite('width', DEFAULT_SCHELLING_CONFIG.gridWidth);
  const height = finite('height', DEFAULT_SCHELLING_CONFIG.gridHeight);
  const density = finite('density', DEFAULT_SCHELLING_CONFIG.density);
  const balance = finite('balance', DEFAULT_SCHELLING_CONFIG.balance);
  const threshold = finite('threshold', DEFAULT_SCHELLING_CONFIG.similarityThreshold);
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error('--width and --height must be positive integers.');
  }
  if ([density, balance, threshold].some((value) => value < 0 || value > 1)) {
    throw new Error('--density, --balance, and --threshold must be values from 0 through 1.');
  }
  const seed = values.has('seed') ? Math.trunc(finite('seed', 0)) : undefined;
  return {
    id,
    port,
    encoding,
    config: id === 'schelling' ? {
      gridWidth: width,
      gridHeight: height,
      density,
      balance,
      similarityThreshold: threshold,
      ...(seed === undefined ? {} : { seed }),
    } : undefined,
  };
}

async function main(): Promise<void> {
  const { id, port, encoding, config } = parseCliArgs(process.argv.slice(2));
  const demo = await startJsExampleWebSocketDemo(id, { port, encoding, config });
  console.log(`Started ${demo.name} at ${demo.url ?? 'unknown url'}`);
}

const currentModulePath = decodeURIComponent(new URL(import.meta.url).pathname);

if (process.argv[1] && currentModulePath === process.argv[1]) {
  void main();
}
