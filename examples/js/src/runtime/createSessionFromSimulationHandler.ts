import { SimulatorSession } from '@tensnap/js/runtime';
import type { InMemorySimulationHandler } from '@tensnap/web-adapter/transport';

export function createSessionFromSimulationHandler(
  handler: InMemorySimulationHandler,
): SimulatorSession {
  return new SimulatorSession({
    async onConnect(session) {
      await handler.onConnect((message) => session.emitter.send(message));
    },
    async onRendererMessage(message) {
      await handler.onMessage(message);
    },
    onDisconnect() {
      handler.onDisconnect();
    },
  });
}