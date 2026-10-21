import { act } from 'react';
import type * as TransportStoreModule from './store/transport';
import { expect, it, vi } from 'vitest';
import { WebSocketManagerImpl } from './transport';
import { useSettingsStore } from './store/settings';
import { mountWebBenchmark, type MountedWebBenchmark } from './benchmark';

const fixture = vi.hoisted(() => ({ transport: null as unknown }));
vi.mock('./components/project/MainViewRenderer', () => ({ MainViewRenderer: () => null }));
vi.mock('./benchmark-ready', () => ({ waitForInitialWebState: async () => {} }));
vi.mock('./store/transport', async (original) => ({
  ...(await original<typeof TransportStoreModule>()),
  createTransportStore: () => ({
    getState: () => ({
      transport: fixture.transport,
      async initialize(transport: unknown) {
        fixture.transport = transport;
      },
      destroy() {
        fixture.transport = null;
      },
    }),
  }),
}));

it('reads effective validation from the current transport after replacement and retirement', async () => {
  const settings = useSettingsStore.getState();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(performance.now()));
    return 1;
  });
  const original = new WebSocketManagerImpl('original', 'ws://unused.test');
  original.clientMessageValidation = original.serverMessageValidation = 'error';
  let mounted: MountedWebBenchmark | undefined;
  try {
    await act(async () => {
      mounted = await mountWebBenchmark(document.createElement('div'), {
        transport: original,
        width: 100,
        height: 100,
        renderTriggerMode: 'setTimeout',
        maxTps: 0,
        maxRenderFps: 0,
        validation: 'error',
      });
    });
    expect(mounted!.validationPolicy()).toEqual({ send: 'error', receive: 'error' });
    const reconnected = new WebSocketManagerImpl('replacement', 'ws://unused.test');
    reconnected.clientMessageValidation = 'warning';
    reconnected.serverMessageValidation = 'off';
    fixture.transport = reconnected;
    expect(mounted!.validationPolicy()).toEqual({ send: 'warning', receive: 'off' });
    await act(async () => mounted!.destroy());
    expect(mounted!.validationPolicy()).toBeUndefined();
    mounted = undefined;
  } finally {
    if (mounted) await act(async () => mounted!.destroy());
    useSettingsStore.setState(settings);
    vi.unstubAllGlobals();
  }
});
