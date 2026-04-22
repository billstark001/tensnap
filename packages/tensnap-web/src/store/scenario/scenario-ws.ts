import { AnyProtocolMessage, ErrorPayload, ISimulatorTransport, ScreenshotRequestPayload, SimulatorToRendererMessage } from '@tensnap/core';
import { StoreApi, UseBoundStore } from 'zustand';
import { ScenarioStore } from './store';
import { getToastState } from '../toast';

const handlers = new WeakMap<ISimulatorTransport, (message: AnyProtocolMessage) => void>();

export function unregisterEventHandlers(transport: ISimulatorTransport) {
  const handler = handlers.get(transport);
  if (!handler) return;
  transport.off('message', handler);
  handlers.delete(transport);
}

async function handleScreenshotRequest(
  transport: ISimulatorTransport,
  useStore: UseBoundStore<StoreApi<ScenarioStore>>,
  payload: ScreenshotRequestPayload,
): Promise<void> {
  const store = useStore.getState();
  const targetId = payload.env_id ?? payload.chart_id;
  if (!targetId) {
    transport.send(store.createScreenshotResponseMessage({
      request_id: payload.request_id,
      error: 'No target specified (env_id or chart_id required)',
    }));
    return;
  }

  const capture = store.getScreenshotCapture(targetId);
  if (!capture) {
    transport.send(store.createScreenshotResponseMessage({
      request_id: payload.request_id,
      error: `No screenshot handler registered for "${targetId}"`,
    }));
    return;
  }

  try {
    const format = payload.format ?? 'png';
    const blob = await capture(format, payload.quality);
    if (!blob) {
      transport.send(store.createScreenshotResponseMessage({
        request_id: payload.request_id,
        error: 'Screenshot capture returned empty result',
      }));
      return;
    }

    const mime = blob.type || (format === 'jpeg' ? 'image/jpeg' : 'image/png');
    const buffer = await blob.arrayBuffer();
    transport.send(store.createScreenshotResponseMessage({
      request_id: payload.request_id,
      data: new Uint8Array(buffer),
      mime,
    }));
  } catch (err) {
    transport.send(store.createScreenshotResponseMessage({
      request_id: payload.request_id,
      error: err instanceof Error ? err.message : String(err),
    }));
  }
}

export function registerEventHandlers(
  transport: ISimulatorTransport,
  useStore: UseBoundStore<StoreApi<ScenarioStore>>,
) {
  unregisterEventHandlers(transport);

  const handler = (message: AnyProtocolMessage) => {
    if (message.type === 'action_start' || message.type === 'asset_sync' || message.type === 'param_change' || message.type === 'state_sync' || message.type === 'screenshot_response') {
      return;
    }

    useStore.getState().applyMessage(message as SimulatorToRendererMessage);
    if (message.type === 'error') {
      const toast = getToastState();
      const payload = message.payload as ErrorPayload;
      toast.error('Error from server', payload.error || 'An unknown error occurred.');
    }
    if (message.type === 'asset_meta') {
      transport.send(useStore.getState().createAssetSyncMessage());
    }
    if (message.type === 'screenshot_request') {
      void handleScreenshotRequest(transport, useStore, message.payload as ScreenshotRequestPayload);
    }
  };

  handlers.set(transport, handler);
  transport.on('message', handler);
}
