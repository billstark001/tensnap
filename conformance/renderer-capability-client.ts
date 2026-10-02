/** Verify renderer capability guards against a real host with checkpoint support disabled. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SimulatorClient } from '../packages/tensnap-agent/src/session/SimulatorClient.ts';

async function main(): Promise<void> {
  const [rawPort, encoding, binding, basePath] = process.argv.slice(2);
  const client = new SimulatorClient();
  const sent: string[] = [];
  client.renderer.addEventListener('outbound', (event) => {
    sent.push((event as CustomEvent<{ message: { type: string } }>).detail.message.type);
  });
  try {
    await client.connect({ simulatorUrl: `ws://127.0.0.1:${rawPort}`,
      encoding: encoding as 'json' | 'msgpack', clientMessageValidation: 'error', serverMessageValidation: 'error' }, false);
    const info = client.renderer.simulatorInfo;
    assert.ok(info);
    assert.ok(!info.capabilities.includes('scene.restore.checkpoint'));
    await client.sync('renderer-no-capability-sync');
    const statePath = binding === 'js' ? `${basePath}.1` : basePath;
    const before = readFileSync(statePath, 'utf8');
    await assert.rejects(client.captureScene(), /does not support checkpoint scene capture/);
    await assert.rejects(client.restoreScene({ checkpoint: { encoding: 'application/octet-stream', data: 'AA==' } }),
      /does not support checkpoint scene restore/);
    assert.equal(readFileSync(statePath, 'utf8'), before);
    assert.ok(!sent.includes('scene_capture'));
    assert.ok(!sent.includes('scene_restore'));
    process.stdout.write(JSON.stringify({ capability_guarded_before_send: true, host_unchanged: true }));
  } finally { client.disconnect(); }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
