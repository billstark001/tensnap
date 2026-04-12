import { AnyProtocolMessage, ErrorPayload, ISimulatorTransport, SimulatorToRendererMessage } from '@tensnap/core';
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

export function registerEventHandlers(
  transport: ISimulatorTransport,
  useStore: UseBoundStore<StoreApi<ScenarioStore>>,
) {
  unregisterEventHandlers(transport);

  const handler = (message: AnyProtocolMessage) => {
    if (message.type === 'action_start' || message.type === 'asset_sync' || message.type === 'param_change' || message.type === 'state_sync') {
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
  };

  handlers.set(transport, handler);
  transport.on('message', handler);
}
