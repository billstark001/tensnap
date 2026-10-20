import type * as FileSystem from 'node:fs/promises';
import { mkdtemp, readFile, rm, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Scenario } from '@tensnap/core/scenario';
import { createSingleSnapshot, frameFromRecording } from '@tensnap/core/snapshot';
import { readCapturedFrame, saveCapturedFrame, compareCapturedFrames } from './frame-files';
import { FrameSaveError } from './frame-errors';
import { RenderBatchError } from './painter';
import { exportRecordingFrame } from './recording-files';
import { encodeRecordingFile } from '@tensnap/core/persistence';
import { snapshotFromFrame } from '@tensnap/core/snapshot';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof FileSystem>();
  return { ...original, rename: vi.fn(original.rename), writeFile: vi.fn(original.writeFile) };
});

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

it('preserves foreign writes in its reserved destination when the evidence commit fails', async () => {
  const output = join(await root(), 'foreign-write');
  await expect(
    saveCapturedFrame(fixture(), output, {
      envIds: ['world'],
      render: async () => {
        await writeFile(join(output, 'foreign.txt'), 'keep me');
        return [{ painterId: 'fixture', kind: 'environment', data: Uint8Array.of(1) }];
      },
    }),
  ).rejects.toBeInstanceOf(FrameSaveError);
  expect(await readFile(join(output, 'foreign.txt'), 'utf8')).toBe('keep me');
});

it('reports the retained temporary directory and original error if preserving partial output also fails', async () => {
  const output = join(await root(), 'rename-failure');
  vi.mocked(rename).mockRejectedValueOnce(new Error('partial rename failed'));
  let failure: FrameSaveError | undefined;
  try {
    await saveCapturedFrame(fixture(), output, {
      envIds: ['world'],
      render: async () => {
        throw new Error('original render failure');
      },
    });
  } catch (error) {
    failure = error as FrameSaveError;
  }
  expect(failure).toBeInstanceOf(FrameSaveError);
  expect(failure!.message).toContain('original render failure');
  expect(failure!.message).toContain('partial rename failed');
  expect(
    JSON.parse(await readFile(join(failure!.partialDirectory, 'failure.json'), 'utf8')).status,
  ).toBe('failed');
  await expect(readFile(join(failure!.partialDirectory, 'manifest.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

it('retains completed artifact values without claiming a path when partial image persistence fails', async () => {
  const original = await vi.importActual<typeof FileSystem>('node:fs/promises');
  vi.mocked(writeFile)
    .mockImplementationOnce(original.writeFile)
    .mockRejectedValueOnce(new Error('partial image write failed'));
  let failure: FrameSaveError | undefined;
  try {
    await saveCapturedFrame(fixture(), join(await root(), 'partial-image'), {
      envIds: ['world'],
      render: async () => {
        throw new RenderBatchError(
          [{ painterId: 'fixture', kind: 'environment', data: Uint8Array.of(1) }],
          [{ painterId: 'fixture', code: 'render_failed', message: 'original target failure' }],
        );
      },
    });
  } catch (error) {
    failure = error as FrameSaveError;
  }
  expect(failure).toBeInstanceOf(FrameSaveError);
  expect(failure!.category).toBe('persistence_failed');
  expect(failure!.message).toContain('original target failure');
  expect(failure!.message).toContain('partial image write failed');
  expect(failure!.artifacts).toMatchObject([{ data: Uint8Array.of(1), path: undefined }]);
  expect(
    JSON.parse(await readFile(join(failure!.partialDirectory, 'failure.json'), 'utf8'))
      .artifacts[0],
  ).not.toHaveProperty('path');
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

it('owns offline selection and export options before reading the recording', async () => {
  const directory = await root();
  const input = join(directory, 'recording.json');
  await writeFile(input, encodeRecordingFile(snapshotFromFrame(fixture())));
  const selection = { frame: 0 };
  const options = { envIds: [] as string[], renderOptions: { width: 640 } };
  const exporting = exportRecordingFrame(input, selection, join(directory, 'export'), options);
  selection.frame = 99;
  options.envIds.push('changed-after-read-started');
  options.renderOptions.width = 1;
  const result = await exporting;
  expect(result.manifest.artifacts).toEqual([]);
  expect(result.manifest.renderOptions.width).toBe(640);
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

it.each([false, true])(
  'preserves partial output and classifies renderer failures (plainError=%s)',
  async (plainError) => {
    const path = join(await root(), 'failed');
    let error: FrameSaveError | undefined;
    try {
      await saveCapturedFrame(fixture(), path, {
        envIds: ['ok', 'bad'],
        render: async (request) => {
          if (request.options.envId === 'bad') {
            if (plainError) throw new Error('Missing target');
            throw new RenderBatchError(
              [],
              [{ painterId: 'fixture', code: 'render_missing', message: 'Missing target' }],
            );
          }
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
  },
);

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

it('saves and verifies MessagePack frame evidence while retaining JSON defaults', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tensnap-msgpack-frame-'));
  roots.push(root);
  const frame = fixture();
  const binary = await saveCapturedFrame(frame, join(root, 'binary'), {
    recordingFormat: 'msgpack',
  });
  expect(binary.manifest.state.path).toBe('state.recording.msgpack');
  expect((await readCapturedFrame(binary.directory)).frame.scene).toEqual(frame.scene);
  const json = await saveCapturedFrame(frame, join(root, 'json'));
  expect(json.manifest.state.path).toBe('state.recording.json');
});
