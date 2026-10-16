// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProtocolBenchmarkWorkload } from '../harness/types';
import { runProtocolBrowserReplicate } from './runner';

const mocks = vi.hoisted(() => ({ createHost: vi.fn(), launch: vi.fn() }));
vi.mock('@tensnap/js/transport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tensnap/js/transport')>()),
  createWebSocketTransportHost: mocks.createHost,
}));
vi.mock('playwright', () => ({ chromium: { launch: mocks.launch } }));

describe('protocol browser failure diagnostics', () => {
  beforeEach(() => vi.resetAllMocks());

  it.each(['page failure', 'outer timeout'])(
    'preserves server and page evidence after a %s',
    async (mode) => {
      const closeHost = vi.fn(async () => {});
      mocks.createHost.mockImplementation((options) => {
        options.onRendererMessage({ type: 'state_sync', payload: {} }, 80);
        options.onSimulatorMessage(
          {
            type: 'error',
            payload: { code: 'sync_failed', message: 'fixture replay failed' },
          },
          120,
        );
        return { url: 'ws://127.0.0.1:12345', close: closeHost };
      });
      const page = {
        on: vi.fn((event, handler) => {
          if (event === 'console')
            handler({ type: () => 'error', text: () => 'fixture console error' });
          if (event === 'pageerror') handler(new Error('fixture page error'));
        }),
        addInitScript: vi.fn(async () => {}),
        goto: vi.fn(async () => {}),
        waitForSelector: vi.fn(async () => {}),
        waitForFunction: vi.fn(async () => {
          if (mode === 'outer timeout') throw new Error('fixture outer timeout');
        }),
        evaluate: vi.fn(async () => ({
          ok: false,
          error: 'Timed out while waiting for the web scenario to finish state sync.',
        })),
      };
      const closeBrowser = vi.fn(async () => {});
      mocks.launch.mockResolvedValue({
        newContext: async () => ({ newPage: async () => page }),
        close: closeBrowser,
      });
      const workload: ProtocolBenchmarkWorkload = {
        schemaVersion: 2,
        id: 'browser-fixture',
        version: 1,
        kind: 'protocol',
        category: 'publication',
        description: 'Browser diagnostics fixture',
        supportedSuites: ['browser'],
        protocolVersion: '0.3',
        modelId: 'fixture-model',
        actionId: 'step',
        actionContinuous: false,
        resolveConfig: () => ({}),
        createSession: vi.fn(),
        createSemanticValidator: () => ({ observe() {}, assert() {}, snapshot: () => ({}) }),
        expectedState: () => ({}),
      };
      const error = await runProtocolBrowserReplicate(
        { pageUrl: 'http://127.0.0.1:12346', close: async () => {} },
        workload,
        { agentCount: 10_000, changedAgents: 0 },
        'msgpack',
        'error',
        25,
        100,
        5,
        { renderTriggerMode: 'requestAnimationFrame', maxTps: 0, maxRenderFps: 0 },
      ).catch((error: Error) => error);

      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toContain('workload=browser-fixture');
      expect(String(error)).toContain('config={"agentCount":10000,"changedAgents":0}');
      expect(String(error)).toContain('encoding=msgpack; validation=error; block=6');
      expect(String(error)).toContain('console: fixture console error');
      expect(String(error)).toContain('pageerror: fixture page error');
      expect(String(error)).toContain('server messages: {"error":1}');
      expect(String(error)).toContain('sync_failed');
      expect(String(error)).toContain(
        'bootstrap messages: [{"direction":"renderer-to-simulator","type":"state_sync"',
      );
      expect(String(error)).toContain(
        'wire bytes: {"rendererToSimulator":80,"simulatorToRenderer":120}',
      );
      expect(closeBrowser).toHaveBeenCalledOnce();
      expect(closeHost).toHaveBeenCalledOnce();
    },
  );
});
