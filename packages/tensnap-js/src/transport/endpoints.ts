import type { PostMessageEndpoint, PostMessageTransfer } from './types';

type EndpointMessageListener = (event: MessageEvent<unknown>) => void;

interface MessageEventTargetLike {
  addEventListener(type: 'message', listener: EndpointMessageListener): void;
  removeEventListener(type: 'message', listener: EndpointMessageListener): void;
}

interface PostMessageTargetLike {
  postMessage(message: unknown, transfer?: readonly PostMessageTransfer[]): void;
}

interface StartableLike {
  start?(): void;
}

interface ClosableLike {
  close?(): void;
}

type PortLike = MessageEventTargetLike & PostMessageTargetLike & StartableLike & ClosableLike;

function createEndpoint(target: PortLike): PostMessageEndpoint {
  const listenerMap = new Map<(message: unknown) => void, EndpointMessageListener>();

  return {
    postMessage(message, transfer) {
      target.postMessage(message, transfer);
    },
    addMessageListener(listener) {
      const wrapped: EndpointMessageListener = (event) => {
        listener(event.data);
      };
      listenerMap.set(listener, wrapped);
      target.addEventListener('message', wrapped);
    },
    removeMessageListener(listener) {
      const wrapped = listenerMap.get(listener);
      if (!wrapped) {
        return;
      }
      listenerMap.delete(listener);
      target.removeEventListener('message', wrapped);
    },
    start: typeof target.start === 'function' ? () => target.start?.() : undefined,
    close: typeof target.close === 'function' ? () => target.close?.() : undefined,
  };
}

export function adaptMessagePort(port: MessagePort): PostMessageEndpoint {
  return createEndpoint(port);
}

export function adaptWorker(worker: Worker): PostMessageEndpoint {
  return createEndpoint(worker);
}

export function createLinkedEndpoints(): { renderer: PostMessageEndpoint; simulator: PostMessageEndpoint } {
  const rendererListeners = new Set<(message: unknown) => void>();
  const simulatorListeners = new Set<(message: unknown) => void>();

  const renderer: PostMessageEndpoint = {
    postMessage(message) {
      queueMicrotask(() => {
        simulatorListeners.forEach((listener) => listener(message));
      });
    },
    addMessageListener(listener) {
      rendererListeners.add(listener);
    },
    removeMessageListener(listener) {
      rendererListeners.delete(listener);
    },
  };

  const simulator: PostMessageEndpoint = {
    postMessage(message) {
      queueMicrotask(() => {
        rendererListeners.forEach((listener) => listener(message));
      });
    },
    addMessageListener(listener) {
      simulatorListeners.add(listener);
    },
    removeMessageListener(listener) {
      simulatorListeners.delete(listener);
    },
  };

  return { renderer, simulator };
}