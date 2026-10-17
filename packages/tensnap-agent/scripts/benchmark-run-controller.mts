/** Isolated renderer-run control overhead; not an end-to-end model benchmark. */
import assert from 'node:assert/strict';
import { RunController } from '@tensnap/core/runtime';
import { Scenario } from '@tensnap/core/scenario';

const iterations = 30_000;
const samplesMs: number[] = [];
let observed = 0;
for (let round = 0; round < 9; round++) {
  let requestId = '';
  let sequence = 0;
  const run = new RunController({
    scenario: new Scenario(),
    send: (message) => {
      requestId = (message.payload as { request_id: string }).request_id;
    },
    idFactory: () => String(++sequence),
    scheduler: { now: () => sequence, setTimeout: () => 0, clearTimeout() {} },
    onStateChange: (status) => {
      observed += status?.completedActions ?? 0;
    },
  });
  const started = performance.now();
  run.start({ mode: 'bounded', actionId: 'step', maxSteps: iterations });
  for (let n = 0; n < iterations; n++) {
    const payload = { id: 'step', request_id: requestId, timings: { simulate_ms: 0.1 } };
    run.observeActionResult(payload);
    run.markActionRendered(payload);
  }
  samplesMs.push(performance.now() - started);
  assert.equal(run.status?.completedActions, iterations);
  assert.equal(run.status?.settled, true);
}
const warmed = samplesMs.slice(2).sort((a, b) => a - b);
console.log(JSON.stringify({ iterations, medianMs: warmed[3], samplesMs, observed }));
