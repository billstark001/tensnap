import { ArtifactInputError, isFileSystemFailure } from './artifact-errors';
import { decodeBinaryString } from '@tensnap/protocol';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, rmdir, writeFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import {
  encodeRecordingFile,
  decodeRecordingFile,
  FrameManifestSchema,
  type FrameManifest,
} from '@tensnap/core/persistence';
import {
  assertFrameCheckpoint,
  frameFromRecording,
  snapshotFromFrame,
  type CapturedFrame,
} from '@tensnap/core/snapshot';
import type { ScenarioSnapshot } from '@tensnap/core/scenario';
import type { SceneRenderOptions } from '../types';
import { RenderBatchError, type RenderArtifact, type RenderRequest } from './painter';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export type FixedFrameRenderer = (request: RenderRequest) => Promise<RenderArtifact[]>;

/** Borrow an owned fixed scene/options, shared read-only across painters; never consult live caches. */
export function fixedRenderRequest(
  scene: ScenarioSnapshot,
  options: SceneRenderOptions,
  reason = 'frame',
): RenderRequest {
  return {
    snapshot: scene,
    options,
    reason,
    trigger: 'explicit',
    at: new Date().toISOString(),
    assets: Object.fromEntries(
      scene.assets
        .filter((asset) => asset.data !== undefined)
        .map((asset) => [
          asset.meta.id,
          { id: asset.meta.id, hash: asset.meta.hash, mime: asset.meta.mime, source: asset.data! },
        ]),
    ),
  };
}

export class FrameSaveError extends Error {
  readonly category: 'persistence_failed' | 'render_failed';
  readonly exitCode: 5 | 6;
  constructor(
    readonly partialDirectory: string,
    readonly artifacts: RenderArtifact[],
    readonly failure: unknown,
  ) {
    super(
      `Frame evidence is incomplete: ${failure instanceof Error ? failure.message : String(failure)}; partial output: ${partialDirectory}`,
    );
    this.category =
      failure instanceof RenderBatchError &&
      failure.errors.every((error) => error.code !== 'persistence_failed')
        ? 'render_failed'
        : 'persistence_failed';
    this.exitCode = this.category === 'render_failed' ? 5 : 6;
  }
}

export async function saveCapturedFrame(
  frameInput: CapturedFrame,
  output: string,
  options: {
    envIds?: string[];
    chartIds?: string[];
    renderOptions?: SceneRenderOptions;
    render?: FixedFrameRenderer;
  } = {},
): Promise<{ directory: string; manifest: FrameManifest }> {
  // Own everything before filesystem/render awaits.
  const frame = structuredClone(frameInput);
  const settings = structuredClone(options.renderOptions ?? {});
  const envIds = [...new Set(options.envIds ?? [])];
  const chartIds = [...new Set(options.chartIds ?? [])];
  const render = options.render;
  const state = encodeRecordingFile(snapshotFromFrame(frame), {
    origin:
      frame.source.kind === 'recording'
        ? {
            recordingId: frame.source.recordingId!,
            frame: frame.source.frame!,
            actionRequestId: frame.source.actionRequestId,
            modelTime: frame.source.modelTime,
          }
        : undefined,
  });
  const target = resolve(output);
  await mkdir(dirname(target), { recursive: true });
  await mkdir(target); // Reserve exclusively; existing evidence is never replaced.
  let temporary: string | undefined;
  const artifacts: RenderArtifact[] = [];
  try {
    temporary = await mkdtemp(join(dirname(target), '.tensnap-frame-'));
    await writeFile(join(temporary, 'state.recording.json'), state);
    const saved: FrameManifest['artifacts'] = [];
    for (const [kind, ids] of [
      ['environment', envIds],
      ['chart', chartIds],
    ] as const) {
      for (const id of ids) {
        if (!render)
          throw new RenderBatchError(
            [],
            [
              {
                painterId: '*',
                code: 'render_missing',
                message: 'Frame rendering was requested without a renderer.',
              },
            ],
          );
        const request = fixedRenderRequest(frame.scene, {
          ...settings,
          envId: kind === 'environment' ? id : undefined,
          chartId: kind === 'chart' ? id : undefined,
          persist: false,
          includeData: true,
        });
        const batch = await render(request);
        if (!batch.length || batch.some((artifact) => !artifact.data?.length))
          throw new RenderBatchError(batch, [
            {
              painterId: '*',
              code: 'render_missing',
              message: `Renderer produced no image bytes for ${kind} ${id}.`,
            },
          ]);
        const encodedId = encodeURIComponent(id).replace(
          /[!'()*]/g,
          (character) => '%' + character.charCodeAt(0).toString(16).toUpperCase(),
        );
        for (const artifact of batch) {
          const path = `${kind}-${encodedId}${batch.length > 1 ? '-' + saved.length : ''}.${settings.format === 'jpeg' ? 'jpeg' : 'png'}`;
          await writeFile(join(temporary, path), artifact.data!);
          artifacts.push({ ...artifact, path });
          saved.push({
            path,
            kind: artifact.kind,
            sha256: digest(artifact.data!),
            ...(artifact.mime ? { mime: artifact.mime } : {}),
            ...(artifact.metadata ? { metadata: artifact.metadata } : {}),
          });
        }
      }
    }
    const manifest = FrameManifestSchema.parse({
      kind: 'tensnap-frame',
      version: 1,
      status: 'complete',
      frameId: frame.id,
      capturedAt: frame.capturedAt,
      source: frame.source,
      modelIdentity: frame.modelIdentity,
      consistency: frame.consistency,
      checkpointStatus: frame.checkpointStatus,
      checkpointReason: frame.checkpointReason,
      state: { path: 'state.recording.json', sha256: digest(state) },
      renderOptions: settings,
      artifacts: saved,
    });
    await writeFile(join(temporary, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    await rename(temporary, target);
    return { directory: target, manifest };
  } catch (error) {
    let partialDirectory = temporary ?? target;
    const failures: unknown[] = [error];
    try {
      if (temporary) {
        if (error instanceof RenderBatchError)
          for (const artifact of error.artifacts) {
            const path = `partial-${artifacts.length}.png`;
            const partial = { ...artifact };
            artifacts.push(partial);
            if (artifact.data?.length) {
              try {
                await writeFile(join(temporary, path), artifact.data);
                partial.path = path;
              } catch (writeError) {
                partial.path = undefined;
                failures.push(writeError);
              }
            }
          }
        await rm(join(temporary, 'manifest.json'), { force: true });
        await writeFile(
          join(temporary, 'failure.json'),
          JSON.stringify(
            {
              status: 'failed',
              error: String(error),
              artifacts: artifacts.map(({ data: _data, ...artifact }) => artifact),
            },
            null,
            2,
          ),
        );
        const failedTarget = `${target}.failed-${randomUUID()}`;
        await rename(temporary, failedTarget);
        partialDirectory = failedTarget;
      }
    } catch (cleanupError) {
      failures.push(cleanupError);
    }
    try {
      // Only remove our empty reservation. Never recursively delete foreign writes.
      await rmdir(target);
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') failures.push(cleanupError);
    }
    const failure =
      failures.length === 1 ? error : new AggregateError(failures, failures.map(String).join('; '));
    throw new FrameSaveError(partialDirectory, artifacts, failure);
  }
}

export async function readCapturedFrame(
  directory: string,
): Promise<{ frame: CapturedFrame; manifest: FrameManifest }> {
  try {
    const root = await realpath(directory);
    const manifest = FrameManifestSchema.parse(
      JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')),
    );
    const readVerified = async (path: string, hash: string) => {
      const actual = await realpath(join(root, path));
      if (!actual.startsWith(root + sep))
        throw new Error('Frame artifact escapes its evidence directory.');
      const data = await readFile(actual);
      if (digest(data) !== hash) throw new Error(`Frame artifact checksum mismatch: ${path}.`);
      return data;
    };
    const state = decodeRecordingFile(
      await readVerified(manifest.state.path, manifest.state.sha256),
    );
    for (const artifact of manifest.artifacts) await readVerified(artifact.path, artifact.sha256);
    if (
      state.snapshot.frames.length ||
      state.snapshot.metadata.id !== manifest.frameId ||
      state.snapshot.metadata.createdAt !== manifest.capturedAt
    )
      throw new Error('Frame manifest does not match its single-frame recording.');
    if (
      JSON.stringify(state.snapshot.metadata.model_identity) !==
      JSON.stringify(manifest.modelIdentity)
    )
      throw new Error('Frame manifest model identity does not match its recording.');
    if (
      manifest.source.kind === 'recording' &&
      (!state.origin ||
        state.origin.recordingId !== manifest.source.recordingId ||
        state.origin.frame !== manifest.source.frame ||
        state.origin.actionRequestId !== manifest.source.actionRequestId ||
        state.origin.modelTime !== manifest.source.modelTime)
    )
      throw new Error('Frame manifest source does not match recording origin.');
    const frame = frameFromRecording(state.snapshot, state.snapshot.initial.frame);
    Object.assign(frame, {
      id: manifest.frameId,
      capturedAt: manifest.capturedAt,
      source: manifest.source,
      consistency: manifest.consistency,
      checkpointStatus: manifest.checkpointStatus,
      checkpointReason: manifest.checkpointReason,
    });
    if (!!frame.checkpoint !== (manifest.checkpointStatus === 'captured'))
      throw new Error('Frame checkpoint availability does not match its manifest.');
    assertFrameCheckpoint(frame);
    return { frame, manifest };
  } catch (error) {
    if (isFileSystemFailure(error)) throw error;
    throw new ArtifactInputError(error);
  }
}

export function compareCapturedFrames(
  left: CapturedFrame,
  right: CapturedFrame,
): {
  equal: boolean;
  changes: Array<{ path: string[]; before: unknown; after: unknown }>;
  checkpointEqual?: boolean;
} {
  const changes: Array<{ path: string[]; before: unknown; after: unknown }> = [];
  const compare = (before: unknown, after: unknown, path: string[]): void => {
    if (Object.is(before, after)) return;
    if (before instanceof Uint8Array && after instanceof Uint8Array) {
      if (before.length === after.length && before.every((byte, index) => byte === after[index]))
        return;
    } else if (
      before &&
      after &&
      typeof before === 'object' &&
      typeof after === 'object' &&
      Array.isArray(before) === Array.isArray(after)
    ) {
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)]))
        compare((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key], [
          ...path,
          key,
        ]);
      return;
    }
    changes.push({ path, before, after });
  };
  compare(left.scene, right.scene, []);
  return {
    equal: changes.length === 0,
    changes,
    ...(left.checkpoint && right.checkpoint
      ? {
          checkpointEqual:
            left.checkpoint.encoding === right.checkpoint.encoding &&
            checkpointBytesEqual(left.checkpoint.data, right.checkpoint.data),
        }
      : {}),
  };
}

function checkpointBytesEqual(left: string | Uint8Array, right: string | Uint8Array): boolean {
  const a = typeof left === 'string' ? decodeBinaryString(left).bytes : left;
  const b = typeof right === 'string' ? decodeBinaryString(right).bytes : right;
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}
