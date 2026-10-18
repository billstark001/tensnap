// @vitest-environment node
import { expect, it } from 'vitest';
import {
  commaSeparatedValues,
  option,
  parseSuites,
  requiredOptions,
  selectedBlocks,
} from './cli-options';

it('reads required values together and retains the command-specific error messages', () => {
  expect(
    requiredOptions(
      ['--profile', 'profile.json', '--input', 'a.jsonl, b.jsonl', '--out', 'out'],
      'merge',
      '--profile',
      '--input',
      '--out',
    ),
  ).toEqual(['profile.json', 'a.jsonl, b.jsonl', 'out']);
  expect(() => requiredOptions([], 'run', '--profile')).toThrow('run requires --profile.');
  expect(() =>
    requiredOptions(['--profile', 'profile.json'], 'merge', '--profile', '--input', '--out'),
  ).toThrow('merge requires --profile, --input, and --out.');
  expect(() => requiredOptions(['--input'], 'report', '--input')).toThrow(
    '--input requires a value.',
  );
  expect(option([], '--input')).toBeUndefined();
});

it('shares CSV trimming while leaving empty-entry policies to each option', () => {
  expect(commaSeparatedValues(' a.jsonl, /tmp/b.jsonl, ')).toEqual(['a.jsonl', '/tmp/b.jsonl', '']);
  expect(parseSuites(' node, , ws ', ['browser'])).toEqual(['node', 'ws']);
  expect(parseSuites(undefined, ['browser'])).toEqual(['browser']);
  expect(() => selectedBlocks(['--block', '1,,2'], 4)).toThrow('--block accepts');
});

it.each([' , ', 'node,unknown', 'Node'])('rejects an invalid suite list: %s', (input) => {
  expect(() => parseSuites(input, ['node'])).toThrow('--suite accepts');
});

it('converts one-based block selections while retaining the journal suffix', () => {
  expect(selectedBlocks(['--block', ' 3, 1 '], 4)).toEqual({
    blocks: [2, 0],
    suffix: '.blocks-3-1',
  });
  expect(selectedBlocks([], 4)).toEqual({ suffix: '' });
  expect(() => selectedBlocks(['--block', '1', '--shard', '1/2'], 4)).toThrow('mutually exclusive');
});

it.each(['0', '5', '1.5', 'NaN', 'Infinity'])('rejects invalid block selections: %s', (input) => {
  expect(() => selectedBlocks(['--block', input], 4)).toThrow('--block accepts');
});

it('partitions every repetition into exactly one shard', () => {
  const shards = Array.from({ length: 3 }, (_, index) =>
    selectedBlocks(['--shard', `${index + 1}/3`], 8),
  );
  expect(shards.map((shard) => shard.suffix)).toEqual([
    '.shard-1-of-3',
    '.shard-2-of-3',
    '.shard-3-of-3',
  ]);
  expect(shards.flatMap((shard) => shard.blocks!).sort((a, b) => a - b)).toEqual([
    0, 1, 2, 3, 4, 5, 6, 7,
  ]);
});

it.each(['1', '0/2', '3/2', '1/0', '1.5/2'])('rejects invalid shards: %s', (input) => {
  expect(() => selectedBlocks(['--shard', input], 8)).toThrow('--shard');
});
