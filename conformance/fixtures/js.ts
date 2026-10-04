/** Deterministic JS binding host for the cross-binding matrix. */
import { writeFileSync } from 'node:fs';
import { modelBuilder } from '../../packages/tensnap-js/src/bindings/index.ts';
import { createWebSocketTransportHost } from '../../packages/tensnap-js/src/transport/index.ts';
import { CounterModel, type Agent, type CounterSnapshot } from './js-model.ts';

const statePath = process.env.TENSNAP_CONFORMANCE_STATE!;
const modelPaths = new WeakMap<CounterModel, string>();
let sessionNumber = 0;
const persist = (model: CounterModel) => {
  const path = modelPaths.get(model);
  if (!path) throw new Error('Conformance model has no sidecar path');
  writeFileSync(path, JSON.stringify(model.snapshot()));
};
const builder = modelBuilder(
  { id: 'conformance.counter', name: 'Conformance counter', description: 'Deterministic protocol fixture', stateSchemaVersion: '1' },
  {
    defaults: { speed: 1 },
    create(config): CounterModel {
      const model = new CounterModel(config.speed);
      const number = sessionNumber++;
      modelPaths.set(model, number === 0 ? statePath : `${statePath}.${number}`);
      persist(model);
      return model;
    },
    getConfig(model) { return { speed: model.speed }; },
    step(model) {
      model.step();
      persist(model);
    },
    ...(process.env.TENSNAP_CONFORMANCE_NO_CHECKPOINT === '1' ? {} : {
      checkpoint: {
        capture(model: CounterModel): CounterSnapshot { return model.snapshot(); },
        restore(model: CounterModel, saved: CounterSnapshot) {
          model.restore(saved);
          persist(model);
        },
      },
    }),
    sceneRestore: { mode: 'compose', restoreTime() {} },
    time(model) { return model.steps; },
  },
)
  .numberParam('speed', {
    min: 0, max: 5, step: 1,
    get: (model) => model.speed,
    normalize: (value) => Math.max(0, Math.min(5, Math.trunc(value))),
    set(model, value) { model.setSpeed(value); persist(model); },
  })
  .monitor('position', { get: (model) => model.x })
  .monitor('population', { get: (model) => model.agents.length })
  .action('fail', { run() { throw new Error('intentional handler failure'); } })
  .action('seed_dense', { run(model) { model.seedDense(); persist(model); } })
  .action('clear_population', { run(model) { model.clearPopulation(); persist(model); } });

builder.env('study')
  .gridLayer('grid', { metadata: { width: 64, height: 64 } })
  .agentLayer<Agent>('agents', {
    metadata: { width: 64, height: 64 },
    items: (model) => model.agents,
    project: (_model, agent) => ({ id: agent.id, x: agent.x, y: agent.y,
      color: { S: '#3498db', I: '#e74c3c', R: '#2ecc71' }[agent.health],
      data: { health: agent.health } }),
  });

const definition = builder.chartGroup('health', {
  label: 'Health states',
  series: [
    { id: 'susceptible', label: 'Susceptible', color: '#3498db', get: (model) => model.counts().susceptible },
    { id: 'infected', label: 'Infected', color: '#e74c3c', get: (model) => model.counts().infected },
    { id: 'recovered', label: 'Recovered', color: '#2ecc71', get: (model) => model.counts().recovered },
  ],
}).build();

createWebSocketTransportHost({
  serverOptions: { port: Number(process.env.TENSNAP_CONFORMANCE_PORT), host: '127.0.0.1' },
  // Match the production example host: every connection owns its session.
  sessionFactory: () => definition.createSession(),
  encoding: process.env.TENSNAP_CONFORMANCE_ENCODING === 'msgpack' ? 'msgpack' : 'json',
});
