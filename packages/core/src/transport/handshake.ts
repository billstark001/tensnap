import type { SimulatorToRendererMessage } from '@tensnap/protocol';
import type { ISimulatorTransport, TransportEventMap } from './types';

export interface TransportHandshake {
  /** Selected by the first valid handshake frame or a legacy mode negotiation. */
  readonly mode: 'strict' | 'legacy';
  /** Stop buffering and return every frame received during connection, in wire order. Call once before replaying them. */
  takeBufferedMessages(): SimulatorToRendererMessage[];
}

/** Connect and validate the first frame while buffering messages for a later renderer attachment. */
export async function connectWithHandshake(
  transport: ISimulatorTransport,
  signal?: AbortSignal,
  timeoutMs = 10_000,
): Promise<TransportHandshake> {
  const messages: SimulatorToRendererMessage[] = [];
  let mode: 'strict' | 'legacy' | null = null;
  let settle: (() => void) | null = null;
  let drained = false;
  const onMessage = (message: TransportEventMap['message']): void => {
    messages.push(message as SimulatorToRendererMessage);
    if (message.type === 'simulator_info') {
      mode = 'strict';
      settle?.();
    }
  };
  const onMode = (detail: TransportEventMap['protocol-mode']): void => {
    if (detail.mode === 'legacy') {
      mode = 'legacy';
      settle?.();
    }
  };
  const stopBuffering = (): void => {
    transport.off('message', onMessage);
    transport.off('protocol-mode', onMode);
  };
  transport.on('message', onMessage);
  transport.on('protocol-mode', onMode);
  try {
    await transport.connect(signal);
    if (signal?.aborted) throw new Error('Connection was aborted');
    if (mode === null) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => { cleanup(); reject(new Error('The simulator did not send simulator_info during handshake.')); }, timeoutMs);
        (timeout as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
        const abort = (): void => { cleanup(); reject(new Error('Connection was aborted')); };
        const close = (): void => { cleanup(); reject(new Error('Disconnected before simulator_info arrived.')); };
        const error = (detail: TransportEventMap['error']): void => {
          cleanup();
          reject(detail instanceof Error ? detail : new Error(String(detail)));
        };
        const cleanup = (): void => {
          clearTimeout(timeout);
          signal?.removeEventListener('abort', abort);
          transport.off('close', close);
          transport.off('error', error);
          settle = null;
        };
        settle = () => { cleanup(); resolve(); };
        signal?.addEventListener('abort', abort, { once: true });
        transport.on('close', close);
        transport.on('error', error);
      });
    }
    if (mode !== 'legacy' && messages[0]?.type !== 'simulator_info') {
      throw new Error('simulator_info must be the first simulator message.');
    }
    return {
      mode: mode ?? 'strict',
      takeBufferedMessages: () => {
        if (drained) throw new Error('Transport handshake messages were already taken.');
        drained = true;
        stopBuffering();
        return messages;
      },
    };
  } catch (error) {
    stopBuffering();
    throw error;
  }
}
