import { parseIPFamily } from '@tensnap/network';

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

export class CliInputError extends Error {
  readonly category = 'input_error';
  readonly exitCode = 2;
}

type Rule = 'string' | 'boolean' | 'number' | 'positive' | 'integer' | 'json' | readonly string[];
const common = { context: 'string', 'context-dir': 'string', 'output-version': ['1'] } as const;
const startup = {
  'simulator-url': 'string',
  host: 'string',
  port: 'integer',
  encoding: ['json', 'msgpack'],
  'ip-family': ['auto', 'ipv4', 'ipv6'],
  'render-trigger': ['manual', 'action-result'],
  'client-message-validation': ['off', 'warning', 'error'],
  'server-message-validation': ['off', 'warning', 'error'],
  'background-color': 'string',
  'max-steps-policy': 'integer',
} as const;
const commands: Record<string, { min: number; max: number; flags?: Record<string, Rule> }> = {
  'daemon serve': { min: 0, max: 0, flags: startup },
  'runtime up': { min: 0, max: 0, flags: { ...startup, foreground: 'boolean' } },
  'runtime down': { min: 0, max: 0 },
  'runtime status': { min: 0, max: 0 },
  'runtime logs': { min: 0, max: 0 },
  'runtime render-trigger': { min: 0, max: 1 },
  'scene inspect': { min: 0, max: 0 },
  'scene snapshot': { min: 0, max: 0 },
  'scene sync': { min: 0, max: 0 },
  'scene capture': { min: 0, max: 0, flags: { output: 'string' } },
  'scene restore': {
    min: 0,
    max: 0,
    flags: {
      checkpoint: 'string',
      time: 'number',
      parameters: 'json',
      envs: 'json',
      'chart-policy': ['preserve', 'replace', 'truncate'],
    },
  },
  'scene render': {
    min: 0,
    max: 1,
    flags: {
      env: 'string',
      chart: 'string',
      width: 'integer',
      height: 'integer',
      viewport: 'json',
      format: ['png', 'jpeg'],
      quality: 'number',
      'background-color': 'string',
      output: 'string',
    },
  },
  'param list': { min: 0, max: 0 },
  'param set': { min: 2, max: 2 },
  'action list': { min: 0, max: 0 },
  'action run': { min: 1, max: 1 },
  'run start': {
    min: 1,
    max: 1,
    flags: {
      'max-steps': 'integer',
      'max-actions': 'integer',
      'stop-when': 'string',
      'max-wall-time-ms': 'positive',
      record: 'boolean',
    },
  },
  'run status': { min: 0, max: 0 },
  'run stop': { min: 0, max: 0 },
  'chart list': { min: 0, max: 0 },
  'chart get': { min: 1, max: 1 },
  'asset list': { min: 0, max: 0 },
  'stream events': { min: 0, max: 0 },
};

/** Parse and validate the complete command before any runtime/file operations. */
export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = Object.create(null);
  const booleanKeys = new Set(['foreground', 'record', 'help']);
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const separator = token.indexOf('=');
    const key = token.slice(2, separator < 0 ? undefined : separator);
    if (key in flags) throw new CliInputError(`Duplicate flag --${key}.`);
    if (booleanKeys.has(key)) {
      if (separator >= 0) throw new CliInputError(`Flag --${key} does not take a value.`);
      flags[key] = true;
    } else {
      const value = separator < 0 ? argv[++index] : token.slice(separator + 1);
      if (value === undefined || value.startsWith('--') || !value.trim())
        throw new CliInputError(
          `Flag --${key} requires a value.${key === 'root-dir' ? ' Use --context-dir.' : ''}`,
        );
      flags[key] = value;
    }
  }
  if (!positional.length && (!Object.keys(flags).length || flags.help)) {
    for (const key of Object.keys(flags))
      if (!['help', 'output-version'].includes(key))
        throw new CliInputError(`Unknown flag --${key}.`);
    if (flags['output-version'] !== undefined && flags['output-version'] !== '1')
      throw new CliInputError('--output-version must be 1.');
    return { positional, flags };
  }
  const key = positional.slice(0, 2).join(' ');
  const command = commands[key];
  if (!command) throw new CliInputError(`Unknown command: ${key}. Use --help.`);
  const rules: Record<string, Rule> = { ...common, ...command.flags };
  for (const [name, value] of Object.entries(flags)) {
    if (name === 'help') continue;
    const rule = rules[name];
    if (!rule)
      throw new CliInputError(
        `Unknown flag --${name} for ${key}.${name === 'root-dir' ? ' Use --context-dir.' : ''}`,
      );
    if (rule === 'boolean') {
      if (value !== true) throw new CliInputError(`Flag --${name} is boolean.`);
      continue;
    }
    if (typeof value !== 'string') throw new CliInputError(`Flag --${name} requires a value.`);
    if (Array.isArray(rule) && !rule.includes(value)) {
      if (name === 'ip-family') {
        try {
          parseIPFamily(value);
        } catch (error) {
          throw new CliInputError((error as Error).message);
        }
      }
      throw new CliInputError(`Flag --${name} must be one of: ${rule.join(', ')}.`);
    }
    if (['number', 'positive', 'integer'].includes(rule as string)) {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new CliInputError(`Flag --${name} must be a finite number.`);
      if (name === 'port' && (!Number.isInteger(n) || n < 0 || n > 65535))
        throw new CliInputError('Flag --port must be an integer from 0 through 65535.');
      if (
        (rule === 'positive' && n <= 0) ||
        (rule === 'integer' && name !== 'port' && (!Number.isSafeInteger(n) || n <= 0))
      )
        throw new CliInputError(
          `Flag --${name} must be a positive ${rule === 'integer' ? 'safe integer' : 'number'}.`,
        );
      if (name === 'quality' && (n < 0 || n > 1))
        throw new CliInputError('--quality must be between 0 and 1.');
    }
    if (rule === 'json') {
      try {
        JSON.parse(value);
      } catch {
        throw new CliInputError(`Flag --${name} must be valid JSON.`);
      }
    }
  }
  const rest = positional.slice(2);
  if (rest.length < command.min || rest.length > command.max)
    throw new CliInputError(
      `${key} requires ${command.min === command.max ? command.min : `${command.min}–${command.max}`} positional arguments.`,
    );
  if (flags.env && flags.chart)
    throw new CliInputError('Flags --env and --chart are mutually exclusive.');
  if (flags['max-actions'] && flags['max-steps'])
    throw new CliInputError('Flags --max-actions and --max-steps are mutually exclusive.');
  if (key === 'run start' && !flags['max-actions'] && !flags['max-steps'])
    throw new CliInputError('run start requires --max-actions <n> (or --max-steps <n>).');
  if (key === 'runtime render-trigger' && rest[0] && !['manual', 'action-result'].includes(rest[0]))
    throw new CliInputError('render-trigger must be manual or action-result.');
  if (flags['simulator-url']) {
    let url: URL;
    try {
      url = new URL(flags['simulator-url'] as string);
    } catch {
      throw new CliInputError('--simulator-url must be a ws:// or wss:// URL.');
    }
    if (!['ws:', 'wss:'].includes(url.protocol))
      throw new CliInputError('--simulator-url must be a ws:// or wss:// URL.');
  }
  if (flags.parameters) {
    const value = JSON.parse(flags.parameters as string);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new CliInputError('--parameters must be a JSON object.');
  }
  if (flags.envs && !Array.isArray(JSON.parse(flags.envs as string)))
    throw new CliInputError('--envs must be a JSON array.');
  if (flags.viewport) {
    const viewport = JSON.parse(flags.viewport as string);
    if (
      !viewport ||
      typeof viewport !== 'object' ||
      !['x', 'y', 'width', 'height'].every(
        (field) => typeof viewport[field] === 'number' && Number.isFinite(viewport[field]),
      ) ||
      viewport.width <= 0 ||
      viewport.height <= 0 ||
      Object.keys(viewport).some((field) => !['x', 'y', 'width', 'height'].includes(field))
    )
      throw new CliInputError('--viewport requires finite x/y and positive width/height.');
  }
  return { positional, flags };
}
