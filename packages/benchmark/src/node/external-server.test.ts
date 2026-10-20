// @vitest-environment node
import { once } from 'node:events';
import { expect, it, vi } from 'vitest';
import { startExternalServer } from './runner';

it('reports spawn failure without an unhandled process error', async () => {
  const server = startExternalServer({ executable: '/tensnap-nonexistent-executable', args: [] });
  await once(server.process, 'error');
  expect(() => server.assertRunning()).toThrow('failed to start');
  await server.stop();
});

it('makes shutdown idempotent and does not signal a retired process group again', async () => {
  const server = startExternalServer({
    executable: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
  });
  const kill = vi.spyOn(process, 'kill');
  try {
    await once(server.process, 'spawn');
    server.assertRunning();
    const first = server.stop();
    expect(server.stop()).toBe(first);
    await first;
    const calls = kill.mock.calls.length;
    await server.stop();
    expect(kill).toHaveBeenCalledTimes(calls);
    expect(() => server.assertRunning()).toThrow('before becoming ready');
  } finally {
    await server.stop();
    kill.mockRestore();
  }
});
