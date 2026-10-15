import { test } from 'vitest';
import { ProtocolCodec } from './codec';
import type { AnyProtocolMessage } from './types';

for (const count of [1, 1000, 10000]) {
  const message: AnyProtocolMessage = {
    type: 'item_update',
    payload: {
      env_id: 'env',
      layer_id: 'agents',
      items: Array.from({ length: count }, (_, id) => ({
        id,
        x: id * 0.25,
        y: id * 0.5,
        data: { state: 'moving', count: id },
      })),
    },
  };
  for (const encoding of ['json', 'msgpack'] as const) {
    test(`${encoding}, ${count} nested items`, async ({ bench }) => {
      const codec = new ProtocolCodec();
      const frame = codec.encode(message, encoding);
      // Each case retains a session codec, just as production transports do.
      // No model, socket, semantic oracle, rendering, or schema validation is timed.
      await bench('encode', () => codec.encode(message, encoding)).run({ time: 500 });
      await bench('decode', () => codec.decode(frame)).run({ time: 500 });
    });
  }
}
