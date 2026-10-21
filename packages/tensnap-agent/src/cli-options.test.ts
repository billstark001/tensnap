import { afterEach, expect, it, vi } from 'vitest';
import { createProgram } from './cli';
import type { CliOptions } from './cli-options';

afterEach(() => vi.restoreAllMocks());

/** Exercise real declarations and validation hooks while replacing only side effects. */
async function invocation(argv: string[]) {
  let result: { command: string; args: string[]; options: CliOptions } | undefined;
  const program = createProgram();
  for (const group of program.commands) {
    for (const command of group.commands) {
      command.action(() => {
        result = {
          command: `${group.name()} ${command.name()}`,
          args: command.processedArgs,
          options: command.optsWithGlobals<CliOptions>(),
        };
      });
    }
  }
  await program.parseAsync(argv, { from: 'user' });
  expect(result).toBeDefined();
  return result!;
}

it.each([
  ['--context', 'demo', '--context-dir', '/tmp/model', 'runtime', 'status'],
  ['runtime', '--context', 'demo', 'status', '--context-dir=/tmp/model'],
  ['runtime', 'status', '--context=demo', '--context-dir', '/tmp/model'],
])('accepts public global options before and after subcommands: %j', async (...argv) => {
  expect(await invocation(argv)).toEqual({
    command: 'runtime status',
    args: [],
    options: { context: 'demo', contextDir: '/tmp/model' },
  });
});

it('converts numeric, boolean, and policy options before a startup handler', async () => {
  expect(
    (
      await invocation([
        'runtime',
        'up',
        '--foreground',
        '--port',
        '0',
        '--max-steps-policy',
        '42',
        '--simulator-url',
        'wss://example.test/simulator',
        '--encoding',
        'json',
        '--ip-family',
        'ipv6',
        '--render-trigger',
        'action-result',
        '--client-message-validation',
        'warning',
        '--server-message-validation',
        'error',
        '--background-color',
        '  #ffffff  ',
      ])
    ).options,
  ).toEqual({
    foreground: true,
    port: 0,
    maxStepsPolicy: 42,
    simulatorUrl: 'wss://example.test/simulator',
    encoding: 'json',
    ipFamily: 'ipv6',
    renderTrigger: 'action-result',
    clientMessageValidation: 'warning',
    serverMessageValidation: 'error',
    backgroundColor: '#ffffff',
  });
});

it('converts render dimensions, viewport JSON, and boundary quality values', async () => {
  for (const quality of ['0', '1']) {
    expect(
      await invocation([
        'scene',
        'render',
        'inspection',
        '--width=12',
        '--height',
        '7',
        '--quality',
        quality,
        '--viewport',
        '{"x":-1,"y":2,"width":3,"height":4}',
        '--format',
        'jpeg',
      ]),
    ).toEqual({
      command: 'scene render',
      args: ['inspection'],
      options: {
        width: 12,
        height: 7,
        quality: Number(quality),
        viewport: { x: -1, y: 2, width: 3, height: 4 },
        format: 'jpeg',
      },
    });
  }
});

it('converts projected restore JSON and permits zero/negative finite times', async () => {
  for (const time of ['0', '-2.5']) {
    expect(
      (
        await invocation([
          'scene',
          'restore',
          '--time',
          time,
          '--parameters',
          '[{"id":"speed","value":2}]',
          '--envs',
          '[]',
          '--chart-policy',
          'truncate',
        ])
      ).options,
    ).toEqual({
      time: Number(time),
      parameters: [{ id: 'speed', value: 2 }],
      envs: [],
      chartPolicy: 'truncate',
    });
  }
});

it.each(['--max-actions', '--max-steps'])('accepts the documented quota flag %s', async (flag) => {
  const result = await invocation([
    'run',
    'start',
    'step',
    flag,
    '3',
    '--max-wall-time-ms',
    '0.5',
    '--record',
  ]);
  expect(result.args).toEqual(['step']);
  expect(result.options).toMatchObject({
    [flag === '--max-actions' ? 'maxActions' : 'maxSteps']: 3,
    maxWallTimeMs: 0.5,
    record: true,
  });
});

it('uses the standard option terminator for literal parameter values', async () => {
  expect(await invocation(['param', 'set', 'label', '--', '--literal'])).toEqual({
    command: 'param set',
    args: ['label', '--literal'],
    options: {},
  });
});

it.each([
  ['recording', 'export', 'id', '--output', 'run.msgpack', '--recording-format', 'msgpack'],
  ['recording', 'start', '--recording-format', 'msgpack'],
  [
    'recording',
    'export-frame',
    'run.msgpack',
    '--frame',
    '0',
    '--output',
    'evidence',
    '--recording-format',
    'msgpack',
    '--format',
    'jpeg',
  ],
  ['frame', 'save', '--output', 'evidence', '--recording-format', 'msgpack', '--format', 'png'],
  ['run', 'start', 'step', '--max-actions', '2', '--record', '--recording-format', 'msgpack'],
])('parses recording encoding independently of image format: %j', async (...argv) => {
  const result = await invocation(argv);
  expect(result.options.recordingFormat).toBe('msgpack');
  if (argv.includes('--format'))
    expect(result.options.format).toBe(argv[argv.indexOf('--format') + 1]);
});
