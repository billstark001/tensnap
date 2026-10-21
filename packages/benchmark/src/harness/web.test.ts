import { expect, it, vi } from 'vitest';
import { createWebScenarioCase } from './web';

const mount = vi.hoisted(() => vi.fn());
vi.mock('@tensnap/web/benchmark', () => ({ mountWebBenchmark: mount }));

it('pins the requested validation in the production Web host and exposes observed policy', async () => {
  const policy = () => ({ send: 'error', receive: 'error' });
  mount.mockResolvedValue({ session: {}, destroy() {}, snapshot() {}, validationPolicy: policy });
  const transport = {} as any;
  const benchmark = createWebScenarioCase({
    name: 'fixture',
    config: {},
    width: 100,
    height: 100,
    validation: 'error',
    createTransport: () => transport,
  });
  const mounted = await benchmark.mount(document.createElement('div'), {
    renderTriggerMode: 'setTimeout',
    maxTps: 0,
    maxRenderFps: 0,
  });
  expect(mount).toHaveBeenCalledWith(
    expect.any(HTMLElement),
    expect.objectContaining({ transport, validation: 'error' }),
  );
  expect(mounted.kind === 'model' && mounted.validationPolicy?.()).toEqual({
    send: 'error',
    receive: 'error',
  });
});
