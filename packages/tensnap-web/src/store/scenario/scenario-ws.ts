import type { ISimulatorTransport, RendererSession } from '@tensnap/core';
import type {
  ErrorPayload,
  ScreenshotRequestPayload,
  SimulatorToRendererMessage,
  StateSyncBoundaryPayload,
} from '@tensnap/protocol';
import { StoreApi, UseBoundStore } from 'zustand';
import { ScenarioStore } from './store';
import { getToastState } from '../toast';

type SessionListeners = {
  session: RendererSession;
  message: EventListener;
};

const handlers = new WeakMap<ISimulatorTransport, SessionListeners>();

export function unregisterEventHandlers(transport: ISimulatorTransport) {
  const listeners = handlers.get(transport);
  if (!listeners) return;
  const session = listeners.session;
  session.removeEventListener('message', listeners.message);
  if (session.attachedTransport === transport) {
    session.detachTransport();
  }
  handlers.delete(transport);
}

async function handleScreenshotRequest(
  useStore: UseBoundStore<StoreApi<ScenarioStore>>,
  payload: ScreenshotRequestPayload,
): Promise<void> {
  const store = useStore.getState();
  const targetId = payload.env_id ?? payload.chart_id;
  if (!targetId) {
    store.session.sendScreenshotResponse({
      request_id: payload.request_id,
      error: 'No target specified (env_id or chart_id required)',
    });
    return;
  }

  const capture = store.getScreenshotCapture(targetId);
  if (!capture) {
    store.session.sendScreenshotResponse({
      request_id: payload.request_id,
      error: `No screenshot handler registered for "${targetId}"`,
    });
    return;
  }

  try {
    const format = payload.format ?? 'png';
    const blob = await capture(format, payload.quality);
    if (!blob) {
      store.session.sendScreenshotResponse({
        request_id: payload.request_id,
        error: 'Screenshot capture returned empty result',
      });
      return;
    }

    const mime = blob.type || (format === 'jpeg' ? 'image/jpeg' : 'image/png');
    const buffer = await blob.arrayBuffer();
    store.session.sendScreenshotResponse({
      request_id: payload.request_id,
      data: new Uint8Array(buffer),
      mime,
    });
  } catch (err) {
    store.session.sendScreenshotResponse({
      request_id: payload.request_id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function registerEventHandlers(
  transport: ISimulatorTransport,
  useStore: UseBoundStore<StoreApi<ScenarioStore>>,
) {
  unregisterEventHandlers(transport);

  const session = useStore.getState().session;
  const handler: EventListener = (event) => {
    const { message } = (event as CustomEvent<{ message: SimulatorToRendererMessage }>).detail;
    if (message.type === 'state_sync_begin') {
      useStore.getState().handleStateSyncBoundary('begin', message.payload as StateSyncBoundaryPayload);
      return;
    }

    if (message.type === 'state_sync_end') {
      useStore.getState().handleStateSyncBoundary('end', message.payload as StateSyncBoundaryPayload);
      return;
    }

    if (message.type === 'error') {
      const toast = getToastState();
      const payload = message.payload as ErrorPayload;
      toast.error('Error from server', payload.error || 'An unknown error occurred.');
    }
    if (message.type === 'screenshot_request') {
      void handleScreenshotRequest(useStore, message.payload as ScreenshotRequestPayload);
    }
  };

  handlers.set(transport, { session, message: handler });
  session.addEventListener('message', handler);
  session.attachTransport(transport);
}
