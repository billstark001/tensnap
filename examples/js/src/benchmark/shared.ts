import type { AnyProtocolMessage, ISimulatorTransport } from '@tensnap/core';

export interface TransportBenchmarkCase {
  name: string;
  config: Record<string, unknown>;
  setup(container: HTMLElement): Promise<void> | void;
  tick(frameIndex: number): Promise<void> | void;
  teardown(): Promise<void> | void;
}

export function extractDeletedIds(items: unknown[]): Array<string | number> {
  return items
    .map((item) => {
      if (typeof item === 'string' || typeof item === 'number') {
        return item;
      }
      if (item && typeof item === 'object' && 'id' in item) {
        return (item as { id: string | number }).id;
      }
      return null;
    })
    .filter((id): id is string | number => id !== null);
}

export function pushChartPoint<TPoint extends { time: number }>(
  points: TPoint[],
  time: number,
  update: Partial<TPoint>,
  maxPoints = 200,
): TPoint[] {
  const next = [...points];
  const existing = next.find((point) => point.time === time);
  if (existing) {
    Object.assign(existing, update);
  } else {
    next.push({ time, ...update } as TPoint);
    next.sort((left, right) => left.time - right.time);
  }
  if (next.length > maxPoints) {
    return next.slice(-maxPoints);
  }
  return next;
}

export function dispatchBenchmarkAction(
  transport: ISimulatorTransport,
  id: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onMessage = (message: AnyProtocolMessage) => {
      if (message.type === 'action_end' && (message.payload as { id?: string }).id === id) {
        cleanup();
        resolve();
      }
      if (message.type === 'error') {
        cleanup();
        reject(new Error(String((message.payload as { error?: string }).error ?? 'Benchmark action failed.')));
      }
    };
    const onClose = () => {
      cleanup();
      reject(new Error('Transport closed before benchmark action completed.'));
    };
    const cleanup = () => {
      transport.off('message', onMessage);
      transport.off('close', onClose);
    };

    transport.on('message', onMessage);
    transport.on('close', onClose);
    transport.send({ type: 'action_start', payload: { id } });
  });
}