import { createWebSocketTransportHost } from '../../../packages/tensnap-js/src/transport/WebSocketTransportHost';
import { createSchellingExample } from '../../../examples/js/src/renderers/schelling';
import { randomWalkBinding, resolveConfig as walkConfig } from '../../v0.3/random-walk/model';
import { resolveConfig } from './benchmark';

const config = resolveConfig(JSON.parse(process.argv[2]!));
const host = createWebSocketTransportHost({
  ip_family: 'ipv4',
  serverOptions: { port: 0 },
  encoding: 'json',
  rendererMessageValidation: 'error',
  simulatorMessageValidation: 'error',
  sessionFactory: () => {
    if (config.case === 'collection') {
      return randomWalkBinding.createSession(
        walkConfig({
          agentCount: config.agentCount,
          changedAgents: config.changedAgents,
          seed: config.seed,
        }),
      );
    }
    return createSchellingExample().createSession({
      gridWidth: config.gridSize,
      gridHeight: config.gridSize,
      density: 0.8,
      balance: 0.5,
      similarityThreshold: 0.8,
      seed: config.seed,
    });
  },
});
await host.ready;
console.log(
  JSON.stringify({
    url: host.url,
    validation: {
      receive: host.rendererMessageValidation,
      send: host.simulatorMessageValidation,
    },
  }),
);
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    void host.close().then(() => {
      process.exitCode = 0;
    });
  });
