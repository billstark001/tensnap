import { Command, Option } from 'commander';
import type { IPFamily } from '@tensnap/network';
import type { ProtocolEncoding, ProtocolValidationLevel } from '@tensnap/protocol';
import type { RenderTriggerMode } from './types';
import type { SkillOptions } from './skills';
import type { ScenarioQuery, FieldPath } from '@tensnap/core/scenario';

export interface CliOptions extends SkillOptions {
  cursor?: string;
  offset?: number;
  rebuildIndex?: boolean;
  collection?: string;
  store?: string;
  query?: ScenarioQuery;
  idType?: 'string' | 'number';
  layer?: string;
  radius?: number;
  fields?: FieldPath[];
  policy?: string;
  from?: number;
  to?: number;
  sampling?: 'boundaries' | 'changes';
  limit?: number;
  after?: number;
  leftFrame?: number;
  rightFrame?: number;
  context?: string;
  contextDir?: string;
  outputVersion?: '1';
  simulatorUrl?: string;
  host?: string;
  port?: number;
  encoding?: ProtocolEncoding;
  ipFamily?: IPFamily;
  renderTrigger?: RenderTriggerMode;
  clientMessageValidation?: ProtocolValidationLevel;
  serverMessageValidation?: ProtocolValidationLevel;
  backgroundColor?: string;
  maxStepsPolicy?: number;
  foreground?: boolean;
  output?: string;
  checkpoint?: string;
  frame?: number;
  match?: 'first' | 'last' | 'before' | 'after';
  snapshotId?: string;
  mode?: 'checkpoint' | 'projected';
  history?: 'preserve' | 'replace' | 'truncate';
  maxFrames?: number;
  maxBytes?: number;
  maxDurationMs?: number;
  retention?: 'rolling' | 'bounded';
  label?: string;
  time?: number;
  parameters?: Record<string, unknown>;
  envs?: unknown[];
  chartPolicy?: 'preserve' | 'replace' | 'truncate';
  env?: string;
  chart?: string;
  width?: number;
  height?: number;
  viewport?: { x: number; y: number; width: number; height: number };
  format?: 'png' | 'jpeg';
  quality?: number;
  maxActions?: number;
  maxSteps?: number;
  stopWhen?: string;
  maxWallTimeMs?: number;
  record?: boolean;
  wait?: boolean;
  until?: 'settled' | 'persisted';
  timeoutMs?: number;
  historyTime?: number;
  replacementCharts?: unknown[];
}

export class CliInputError extends Error {
  readonly category = 'input_error';
  readonly exitCode = 2;
}

/** Apply the CLI's strict single-use and non-empty value policy to Commander options. */
export function addOptions(command: Command, options: Option[]): void {
  for (const option of options) {
    const parse = option.parseArg;
    option.argParser((value, previous: unknown) => {
      if (previous !== undefined) throw new CliInputError(`Duplicate flag ${option.long}.`);
      if (option.isBoolean()) return true;
      if (!value.trim() || value.startsWith('--'))
        throw new CliInputError(`Flag ${option.long} requires a value.`);
      return parse ? parse(value, previous) : value;
    });
    command.addOption(option);
  }
}

export function numericOption(
  flags: string,
  description: string,
  rule: 'finite' | 'integer' | 'positive' | 'port' | 'quality' = 'finite',
): Option {
  const option = new Option(flags, description);
  return option.argParser((raw) => {
    const value = Number(raw);
    if (!Number.isFinite(value))
      throw new CliInputError(`Flag ${option.long} must be a finite number.`);
    if (rule === 'port' && (!Number.isInteger(value) || value < 0 || value > 65535))
      throw new CliInputError('Flag --port must be an integer from 0 through 65535.');
    if (rule === 'integer' && (!Number.isSafeInteger(value) || value <= 0))
      throw new CliInputError(`Flag ${option.long} must be a positive safe integer.`);
    if (rule === 'positive' && value <= 0)
      throw new CliInputError(`Flag ${option.long} must be a positive number.`);
    if (rule === 'quality' && (value < 0 || value > 1))
      throw new CliInputError('--quality must be between 0 and 1.');
    return value;
  });
}

export function jsonOption(
  flags: string,
  description: string,
  kind: 'object' | 'array' | 'viewport',
): Option {
  const option = new Option(flags, description);
  return option.argParser((raw) => {
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new CliInputError(`Flag ${option.long} must be valid JSON.`);
    }
    if (kind === 'object' && (!value || typeof value !== 'object' || Array.isArray(value)))
      throw new CliInputError(`${option.long} must be a JSON object.`);
    if (kind === 'array' && !Array.isArray(value))
      throw new CliInputError(`${option.long} must be a JSON array.`);
    if (
      kind === 'viewport' &&
      (!value ||
        typeof value !== 'object' ||
        !['x', 'y', 'width', 'height'].every(
          (field) => typeof value[field] === 'number' && Number.isFinite(value[field]),
        ) ||
        value.width <= 0 ||
        value.height <= 0 ||
        Object.keys(value).some((field) => !['x', 'y', 'width', 'height'].includes(field)))
    )
      throw new CliInputError('--viewport requires finite x/y and positive width/height.');
    return value;
  });
}

/** Each command owns fresh Option instances; declarations also generate its help. */
export function startupOptions(): Option[] {
  return [
    new Option('--simulator-url <url>', 'Connect to a ws:// or wss:// simulator.').argParser(
      (value) => {
        let url;
        try {
          url = new URL(value);
        } catch {
          throw new CliInputError('--simulator-url must be a ws:// or wss:// URL.');
        }
        if (!['ws:', 'wss:'].includes(url.protocol))
          throw new CliInputError('--simulator-url must be a ws:// or wss:// URL.');
        return value;
      },
    ),
    new Option('--host <host>', 'Control listener hostname or IP address.'),
    numericOption(
      '--port <port>',
      'Control port from 0 through 65535; 0 selects an available port.',
      'port',
    ),
    new Option('--encoding <encoding>', 'Simulator wire encoding (default: msgpack).').choices([
      'json',
      'msgpack',
    ]),
    new Option('--ip-family <family>', 'IP family policy (default: auto).').choices([
      'auto',
      'ipv4',
      'ipv6',
    ]),
    new Option('--render-trigger <mode>', 'Automatic rendering policy (default: manual).').choices([
      'manual',
      'action-result',
    ]),
    new Option('--client-message-validation <level>', 'Client message validation policy.').choices([
      'off',
      'warning',
      'error',
    ]),
    new Option('--server-message-validation <level>', 'Server message validation policy.').choices([
      'off',
      'warning',
      'error',
    ]),
    new Option('--background-color <css-color>', 'Default render background color.').argParser(
      (value) => value.trim(),
    ),
    numericOption(
      '--max-steps-policy <count>',
      'Positive runtime action-count policy limit.',
      'integer',
    ),
  ];
}

export function imageOptions(targetsExclusive = true): Option[] {
  const env = new Option('--env <id>', 'Environment to render.');
  const chart = new Option('--chart <id>', 'Chart to render.');
  if (targetsExclusive) {
    env.conflicts('chart');
    chart.conflicts('env');
  }
  return [
    env,
    chart,
    numericOption('--width <pixels>', 'Image width.', 'integer'),
    numericOption('--height <pixels>', 'Image height.', 'integer'),
    jsonOption('--viewport <json>', 'Viewport bounds.', 'viewport'),
    new Option('--format <format>', 'Image format.').choices(['png', 'jpeg']),
    numericOption('--quality <number>', 'JPEG quality.', 'quality'),
    new Option('--background-color <color>', 'Image background color.'),
    new Option('--output <path>', 'Output path.'),
  ];
}

export function selectionOptions(): Option[] {
  return [
    numericOption('--frame <index>', 'Retained frame index.')
      .argParser((raw) => {
        const value = Number(raw);
        if (!Number.isSafeInteger(value) || value < 0)
          throw new CliInputError('--frame must be a nonnegative safe integer.');
        return value;
      })
      .conflicts(['time', 'match']),
    numericOption('--time <number>', 'Model time to select.').conflicts('frame'),
    new Option('--match <rule>', 'Required model-time matching rule.')
      .choices(['first', 'last', 'before', 'after'])
      .conflicts('frame'),
    new Option('--snapshot-id <id>', 'Recording ID to extract from a project file.'),
  ];
}
