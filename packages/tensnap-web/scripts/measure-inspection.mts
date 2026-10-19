import { performance } from 'node:perf_hooks';
import { Scenario, ScenarioInspector } from '@tensnap/core/scenario';
import { createAgentInspectionSource } from '../src/workbench/agent-inspection-source.ts';

// A local diagnostic of projection/JSON delivery cost, not a Tauri IPC or rendering benchmark.
const rows = [];
for (const population of [1_000, 10_000, 100_000]) {
  const scenario = new Scenario();
  scenario.apply({ type: 'env_create', payload: { id: 'world', type: '2d' } });
  scenario.apply({
    type: 'env_layer_create',
    payload: {
      env_id: 'world',
      layer_id: 'agents',
      layer_type: 'agent',
      metadata: { coord_offset: 'float' },
    },
  });
  scenario.apply({
    type: 'item_create',
    payload: {
      env_id: 'world',
      layer_id: 'agents',
      items: Array.from({ length: population }, (_, id) => ({
        id,
        x: id < 25 ? id % 5 : id + 100,
        y: id < 25 ? Math.floor(id / 5) : 100,
      })),
    },
  });
  const ref = { environmentId: 'world', layerId: 'agents', agentId: 12 };
  const inspector = new ScenarioInspector(scenario);
  const started = performance.now();
  const source = createAgentInspectionSource(scenario, ref);
  const indexSetupMs = performance.now() - started;
  const receive = new Scenario();
  const signal = new AbortController().signal;
  const native: number[] = [];
  const local: number[] = [];
  let payloadBytes = 0;
  for (let index = 0; index < 120; index++) {
    const beginLocal = performance.now();
    inspector.inspectLive(ref, { radius: 3 });
    const localMs = performance.now() - beginLocal;
    const beginNative = performance.now();
    const result = await source.read({ radius: 3, assets: {} }, signal);
    const json = JSON.stringify(result);
    const decoded = JSON.parse(json);
    if (decoded.view) receive.load(decoded.view.scene);
    const nativeMs = performance.now() - beginNative;
    payloadBytes = Buffer.byteLength(json);
    if (index >= 20) {
      native.push(nativeMs);
      local.push(localMs);
    }
  }
  const percentile = (values: number[], fraction: number) =>
    +values.sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)].toFixed(3);
  rows.push({
    population,
    visibleAgents: 25,
    payloadBytes,
    indexSetupMs: +indexSetupMs.toFixed(3),
    localMedianMs: percentile(local, 0.5),
    projectionJsonReceiveMedianMs: percentile(native, 0.5),
    projectionJsonReceiveP95Ms: percentile(native, 0.95),
  });
  source.dispose();
}
console.log(
  JSON.stringify(
    {
      samples: 100,
      warmup: 20,
      includes:
        'owner query + viewport projection + JSON stringify/parse + receiving Scenario.load; excludes real IPC and canvas paint',
      rows,
    },
    null,
    2,
  ),
);
