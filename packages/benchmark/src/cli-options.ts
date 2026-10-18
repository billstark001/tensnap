import type { BenchmarkSuite } from './harness/types';

export function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

export function parseSuites(
  value: string | undefined,
  fallback: readonly BenchmarkSuite[],
): BenchmarkSuite[] {
  if (!value) return [...fallback];
  const parsed = commaSeparatedValues(value).filter(Boolean);
  if (parsed.length === 0 || parsed.some((entry) => !['node', 'ws', 'browser'].includes(entry))) {
    throw new Error('--suite accepts a comma-separated subset of node,ws,browser.');
  }
  return parsed as BenchmarkSuite[];
}

/** Validate required raw values together, before resolving paths or loading inputs. */
export function requiredOptions(
  args: readonly string[],
  command: string,
  ...names: string[]
): string[] {
  const values = names.map((name) => option(args, name));
  if (values.some((value) => value === undefined)) {
    const requirements =
      names.length < 2
        ? names[0]
        : `${names.slice(0, -1).join(', ')}${names.length > 2 ? ',' : ''} and ${names[names.length - 1]}`;
    throw new Error(`${command} requires ${requirements}.`);
  }
  return values as string[];
}

export function commaSeparatedValues(value: string): string[] {
  return value.split(',').map((entry) => entry.trim());
}

export function selectedBlocks(
  args: readonly string[],
  repetitions: number,
): { blocks?: number[]; suffix: string } {
  const blockInput = option(args, '--block');
  const shardInput = option(args, '--shard');
  if (blockInput && shardInput) throw new Error('--block and --shard are mutually exclusive.');
  if (blockInput) {
    const oneBased = commaSeparatedValues(blockInput).map(Number);
    if (
      oneBased.length === 0 ||
      oneBased.some((value) => !Number.isInteger(value) || value < 1 || value > repetitions)
    ) {
      throw new Error(`--block accepts comma-separated values from 1 through ${repetitions}.`);
    }
    return { blocks: oneBased.map((value) => value - 1), suffix: `.blocks-${oneBased.join('-')}` };
  }
  if (shardInput) {
    const match = /^(\d+)\/(\d+)$/.exec(shardInput);
    if (!match) throw new Error('--shard must use one-based INDEX/COUNT syntax, for example 1/4.');
    const index = Number(match[1]);
    const count = Number(match[2]);
    if (
      !Number.isInteger(index) ||
      !Number.isInteger(count) ||
      count < 1 ||
      index < 1 ||
      index > count
    )
      throw new Error('--shard INDEX must be from 1 through COUNT.');
    return {
      blocks: Array.from({ length: repetitions }, (_, block) => block).filter(
        (block) => block % count === index - 1,
      ),
      suffix: `.shard-${index}-of-${count}`,
    };
  }
  return { suffix: '' };
}
