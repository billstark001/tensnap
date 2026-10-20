// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { hashBytes } from './files';
import { verifyWorkflow, workflowHosts, type WorkflowReport } from './workflow';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});
const digest = (value: string) => hashBytes(value);

async function fixture(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'tensnap-workflow-verifier-'));
  directories.push(directory);
  const sourceHashes = { 'model.py': digest('model source') };
  const provenance = {
    revision: 'test-revision',
    sourceDigest: digest(JSON.stringify(sourceHashes)),
  };
  await writeFile(
    path.join(directory, 'summary.json'),
    JSON.stringify({
      ...provenance,
      sourceHashes,
      hosts: workflowHosts.map((host) => ({ host, pass: true, report: `${host}/report.json` })),
    }),
  );
  for (const host of workflowHosts) {
    const folder = path.join(directory, host);
    await mkdir(folder);
    const point = (index: number, prefix = 'future') => ({
      time: index + 6,
      stateHash: digest(`${prefix}:state:${index}`),
      agentsHash: digest(`${prefix}:agents:${index}`),
      metrics: {},
      threshold: 0.65,
    });
    const future = Array.from({ length: 3 }, (_, index) => point(index));
    const checkpoint = JSON.stringify({
      model_id: host === 'js' ? 'schelling' : 'examples.schelling',
      state_schema_version: '2',
    });
    const png = Buffer.alloc(24);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    const report: WorkflowReport = {
      ...provenance,
      host,
      setup: {
        gridWidth: 16,
        gridHeight: 12,
        seed: 7,
        protocolEncoding: 'json',
        validation: 'error',
      },
      boundedRun: { completedSteps: 5 },
      checkpoint: {
        modelId: JSON.parse(checkpoint).model_id,
        schema: '2',
        sha256: digest(checkpoint),
      },
      exactRestore: { captured: digest('captured'), restored: digest('captured'), pass: true },
      deterministicFuture: { future, replay: structuredClone(future), pass: true },
      branches: [0.55, 0.8].map((threshold) => ({
        threshold,
        trajectory: Array.from({ length: 6 }, (_, index) => ({
          ...point(index, `branch:${threshold}`),
          threshold,
        })),
      })),
      rendering: { width: 640, height: 480, sha256: hashBytes(png) },
    };
    await writeFile(path.join(folder, 'report.json'), JSON.stringify(report));
    await writeFile(path.join(folder, 'checkpoint.json'), checkpoint);
    await writeFile(path.join(folder, 'scene.png'), png);
  }
  return directory;
}

describe('workflow report verification', () => {
  it('verifies the original report contract without seed diagnostic artifacts', async () => {
    await verifyWorkflow(await fixture());
  });

  it('rejects divergent replay despite a recorded pass flag', async () => {
    const directory = await fixture();
    const file = path.join(directory, 'python/report.json');
    const report = JSON.parse(await readFile(file, 'utf8')) as WorkflowReport;
    report.deterministicFuture.replay[1]!.stateHash = digest('wrong state');
    await writeFile(file, JSON.stringify(report));
    await expect(verifyWorkflow(directory)).rejects.toThrow('Rerun differs');
  });

  it('checks retained checkpoint bytes', async () => {
    const directory = await fixture();
    await writeFile(path.join(directory, 'python/checkpoint.json'), '{}');
    await expect(verifyWorkflow(directory)).rejects.toThrow('Retained checkpoint bytes differ');
  });
});
