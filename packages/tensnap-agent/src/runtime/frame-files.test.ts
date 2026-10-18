import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Scenario } from '@tensnap/core/scenario';
import { createSingleSnapshot, frameFromRecording } from '@tensnap/core/snapshot';
import {
  readCapturedFrame,
  saveCapturedFrame,
  compareCapturedFrames,
  FrameSaveError,
} from './frame-files';
import { RenderBatchError } from './painter';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'tensnap-frame-test-'));
  roots.push(path);
  return path;
}
function fixture() {
  const scene = new Scenario().dump();
  scene.metadata.time = 8;
  scene.charts = [{ id: 'chart', label: 'Chart', metadataDict: {}, data: [{ time: 3, value: 5 }] }];
  scene.monitors = [{ id: 'monitor', label: 'Monitor', value: { values: [1] } }];
  return frameFromRecording(
    createSingleSnapshot(scene, {
      id: 'recording',
      modelIdentity: { model_id: 'model', state_schema_version: 'v1' },
      checkpoint: {
        model_id: 'model',
        state_schema_version: 'v1',
        encoding: 'raw',
        data: Uint8Array.of(1, 2),
      },
    }),
    0,
  );
}

it('writes one independent state and a verifiable manifest, preserving provenance and chart prefixes', async () => {
  const directory = join(await root(), 'evidence');
  const frame = fixture();
  const result = await saveCapturedFrame(frame, directory);
  expect(result.manifest.source).toMatchObject({
    recordingId: 'recording',
    frame: 0,
    modelTime: 8,
  });
  const loaded = await readCapturedFrame(directory);
  expect(compareCapturedFrames(frame, loaded.frame).equal).toBe(true);
  expect(loaded.frame.checkpoint).toBeDefined();
  await expect(saveCapturedFrame(frame, directory)).rejects.toMatchObject({ code: 'EEXIST' });
  await writeFile(join(directory, 'state.recording.json'), '{}');
  await expect(readCapturedFrame(directory)).rejects.toThrow(/checksum/);
});

it('all render requests consume one owned scene despite source mutations during rendering', async () => {
  const frame = fixture();
  const inputs: unknown[] = [];
  const result = await saveCapturedFrame(frame, join(await root(), 'rendered'), {
    envIds: ['world'],
    chartIds: ['chart'],
    render: async (request) => {
      inputs.push(structuredClone(request.snapshot.monitors));
      frame.scene.monitors[0].value = { values: [99] };
      return [
        {
          painterId: 'fixture',
          kind: request.options.chartId ? 'chart' : 'environment',
          mime: 'image/png',
          data: Uint8Array.of(1, 2, 3),
        },
      ];
    },
  });
  expect(inputs).toEqual([
    [{ id: 'monitor', label: 'Monitor', value: { values: [1] } }],
    [{ id: 'monitor', label: 'Monitor', value: { values: [1] } }],
  ]);
  expect(result.manifest.artifacts).toHaveLength(2);
  expect((await readCapturedFrame(result.directory)).frame.scene.monitors[0].value).toEqual({
    values: [1],
  });
});

it('preserves partial output without a successful manifest after a required render fails', async () => {
  const path = join(await root(), 'failed');
  let error: FrameSaveError | undefined;
  try {
    await saveCapturedFrame(fixture(), path, {
      envIds: ['ok', 'bad'],
      render: async (request) => {
        if (request.options.envId === 'bad')
          throw new RenderBatchError(
            [],
            [{ painterId: 'fixture', code: 'render_missing', message: 'Missing target' }],
          );
        return [{ painterId: 'fixture', kind: 'environment', data: Uint8Array.of(1) }];
      },
    });
  } catch (cause) {
    error = cause as FrameSaveError;
  }
  expect(error).toBeInstanceOf(FrameSaveError);
  expect(error?.category).toBe('render_failed');
  expect(error?.artifacts).toHaveLength(1);
  await expect(readFile(join(error!.partialDirectory, 'manifest.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  expect(
    JSON.parse(await readFile(join(error!.partialDirectory, 'failure.json'), 'utf8')).status,
  ).toBe('failed');
});

it('owns and deduplicates render targets and supports punctuation in public IDs', async () => {
  const envIds = ["world!'()*", "world!'()*"];
  let calls = 0;
  const options: NonNullable<Parameters<typeof saveCapturedFrame>[2]> = {
    envIds,
    chartIds: ['chart'],
    render: async () => {
      calls++;
      envIds.push('added-during-render');
      options.render = async () => {
        throw new Error('Changed renderer');
      };
      return [{ painterId: 'fixture', kind: 'environment', data: Uint8Array.of(1) }];
    },
  };
  const result = await saveCapturedFrame(fixture(), join(await root(), 'punctuation'), options);
  expect(calls).toBe(2);
  expect(result.manifest.artifacts).toMatchObject([
    { path: 'environment-world%21%27%28%29%2A.png' },
    { path: 'chart-chart.png' },
  ]);
  expect((await readCapturedFrame(result.directory)).manifest).toEqual(result.manifest);
});
