import type { DiagnosticSeverity } from '@tensnap/core';
import type {
  ActionResultPayload,
  ErrorPayload,
  NormalizedLogPayload,
  ScreenshotRequestPayload,
  ScreenshotResponsePayload,
  SimulatorToRendererMessage,
  StateSyncBeginPayload,
  StateSyncEndPayload,
} from '@tensnap/protocol';
import { StoreApi, UseBoundStore } from 'zustand';
import { ScenarioStore } from './store';

const diagnosticSeverityFromLog = (level: NormalizedLogPayload['level']): DiagnosticSeverity => (
  level === 'critical' ? 'critical' : level
);

async function handleScreenshotRequest(
  useStore: UseBoundStore<StoreApi<ScenarioStore>>,
  payload: ScreenshotRequestPayload,
): Promise<void> {
  const store = useStore.getState();
  const session = store.session;
  const sendResponse = (response: ScreenshotResponsePayload) => {
    if (!session.isConnected) return;
    try {
      session.sendScreenshotResponse(response);
    } catch (error) {
      store.appendDiagnostic({
        severity: 'error', domain: 'ui', source: 'screenshot', code: 'screenshot_response_failed',
        message: error instanceof Error ? error.message : String(error), requestId: payload.request_id,
      });
    }
  };
  const targetId = payload.env_id ?? payload.chart_id;
  if (!targetId) {
    store.appendDiagnostic({
      severity: 'warning', domain: 'ui', source: 'screenshot', code: 'invalid_screenshot_target',
      message: 'No screenshot target was specified by the simulator.', requestId: payload.request_id,
    });
    sendResponse({
      request_id: payload.request_id,
      error: { code: 'invalid_screenshot_target', message: 'No target specified (env_id or chart_id required)' },
    });
    return;
  }

  const capture = store.getScreenshotCapture(targetId);
  if (!capture) {
    store.appendDiagnostic({
      severity: 'warning', domain: 'ui', source: 'screenshot', code: 'screenshot_handler_missing',
      message: `No screenshot handler is registered for "${targetId}".`, requestId: payload.request_id, target: targetId,
    });
    sendResponse({
      request_id: payload.request_id,
      error: { code: 'screenshot_handler_missing', message: `No screenshot handler registered for "${targetId}"` },
    });
    return;
  }

  let connectionClosed = false;
  const onClose = () => { connectionClosed = true; };
  session.addEventListener('transport:close', onClose);
  try {
    const format = payload.format ?? 'png';
    const blob = await capture(format, payload.quality);
    if (connectionClosed) return;
    if (!blob) {
      sendResponse({
        request_id: payload.request_id,
        error: { code: 'screenshot_empty', message: 'Screenshot capture returned empty result' },
      });
      return;
    }

    const mime = blob.type || (format === 'jpeg' ? 'image/jpeg' : 'image/png');
    const buffer = await blob.arrayBuffer();
    if (connectionClosed) return;
    sendResponse({
      request_id: payload.request_id,
      data: new Uint8Array(buffer),
      mime,
    });
  } catch (err) {
    if (connectionClosed) return;
    store.appendDiagnostic({
      severity: 'error', domain: 'ui', source: 'screenshot', code: 'screenshot_failed',
      message: err instanceof Error ? err.message : String(err), requestId: payload.request_id, target: targetId,
    });
    sendResponse({
      request_id: payload.request_id,
      error: { code: 'screenshot_failed', message: err instanceof Error ? err.message : String(err) },
    });
  } finally {
    session.removeEventListener('transport:close', onClose);
  }
}

export function registerEventHandlers(
  useStore: UseBoundStore<StoreApi<ScenarioStore>>,
): () => void {
  const session = useStore.getState().session;
  const handler: EventListener = (event) => {
    const { message } = (event as CustomEvent<{ message: SimulatorToRendererMessage }>).detail;
    if (message.type === 'state_sync_begin') {
      useStore.getState().handleStateSyncBoundary('begin', message.payload as StateSyncBeginPayload);
      return;
    }

    if (message.type === 'state_sync_end') {
      useStore.getState().handleStateSyncBoundary('end', message.payload as StateSyncEndPayload);
      return;
    }

    if (message.type === 'error') {
      const payload = message.payload as ErrorPayload;
      const stateSync = useStore.getState().stateSync;
      if (stateSync.requestId && payload.request_id === stateSync.requestId) {
        useStore.getState().resetStateSync();
      }
      useStore.getState().appendDiagnostic({
        severity: 'error', domain: 'simulator', source: 'simulator', code: payload.code,
        message: payload.message || 'An unknown simulator error occurred.', requestId: payload.request_id,
        details: payload.data,
      });
    }
    if (message.type === 'action_result') {
      const payload = message.payload as ActionResultPayload;
      if (payload.error) {
        useStore.getState().appendDiagnostic({
          severity: 'error', domain: 'simulator', source: 'simulator', code: payload.error.code,
          message: payload.error.message, requestId: payload.request_id, target: payload.id,
          details: payload.error.data,
        });
      }
    }
    if (message.type === 'log') {
      const payload = message.payload as NormalizedLogPayload;
      useStore.getState().appendDiagnostic({
        severity: diagnosticSeverityFromLog(payload.level), domain: 'simulator', source: 'simulator',
        code: 'log', message: payload.message, target: payload.target, details: payload.data,
        timestamp: payload.timestamp,
      });
    }
    if (message.type === 'screenshot_request') {
      void handleScreenshotRequest(useStore, message.payload as ScreenshotRequestPayload);
    }
  };

  const protocolError: EventListener = (event) => {
    const payload = (event as CustomEvent<ErrorPayload>).detail;
    const stateSync = useStore.getState().stateSync;
    if (stateSync.requestId && payload.request_id === stateSync.requestId) {
      useStore.getState().resetStateSync();
    }
  };

  session.addEventListener('message', handler);
  session.addEventListener('protocol:error', protocolError);
  return () => {
    session.removeEventListener('message', handler);
    session.removeEventListener('protocol:error', protocolError);
  };
}
