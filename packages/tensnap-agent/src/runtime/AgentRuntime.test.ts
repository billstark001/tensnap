import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentRuntime } from './AgentRuntime';
import { resolveRuntimeContextPaths } from './context';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('AgentRuntime checkpointing', () => {
  it('does not dump or write a checkpoint for every live tick', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-checkpoint-'));
    temporaryRoots.push(rootDir);
    const writes: unknown[] = [];
    const runtime = new AgentRuntime(resolveRuntimeContextPaths({ rootDir }), {
      checkpointIntervalMs: 1_000,
      checkpointWriter: async (_context, snapshot) => { writes.push(snapshot); },
    });
    await runtime.initialize();
    const renderer = (runtime as unknown as { renderer: { scenario: { dump: () => unknown }; handleIncoming: (message: unknown) => void } }).renderer;
    const dump = vi.spyOn(renderer.scenario, 'dump');

    for (let tick = 1; tick <= 100; tick += 1) {
      renderer.handleIncoming({ type: 'metadata_update', payload: { tick } });
    }

    expect(dump).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
    await runtime.stop();

    expect(dump).toHaveBeenCalledTimes(1);
    expect(writes).toHaveLength(1);
    expect((writes[0] as { metadata: { tick: number } }).metadata.tick).toBe(100);
  });
});
