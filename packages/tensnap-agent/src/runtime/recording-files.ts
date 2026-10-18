import { ArtifactInputError, isFileSystemFailure } from './artifact-errors';
import { readFile } from 'node:fs/promises';
import {
  decodePersistenceValue,
  parseProjectFileContent,
  parseRecordingFile,
  selectRecordingFrame,
  inspectRecording,
  type RecordingDocument,
  type RecordingSelection,
} from '@tensnap/core/persistence';
import { frameFromRecording } from '@tensnap/core/snapshot';
import type { SceneRenderOptions } from '../types';
import { fixedRenderRequest, saveCapturedFrame } from './frame-files';
import { RenderBatchError, type RenderArtifact, type RenderRequest } from './painter';

/** Reads project contents without opening a source or connecting its simulator. */
export async function readRecording(path: string, snapshotId?: string): Promise<RecordingDocument> {
  try {
    const value = decodePersistenceValue(await readFile(path));
    if (value && typeof value === 'object' && 'snapshots' in value && !('kind' in value)) {
      const project = parseProjectFileContent(value);
      const snapshot = snapshotId
        ? project.snapshots.find((snapshot) => snapshot.metadata.id === snapshotId)
        : project.snapshots.length === 1
          ? project.snapshots[0]
          : undefined;
      if (!snapshot)
        throw new Error(
          `Select a project recording with --snapshot-id. Available: ${project.snapshots.map((snapshot) => snapshot.metadata.id).join(', ')}`,
        );
      return { snapshot, report: inspectRecording(snapshot) };
    }
    if (snapshotId) throw new Error('--snapshot-id requires a project file.');
    return parseRecordingFile(value, { allowLegacy: true });
  } catch (error) {
    if (isFileSystemFailure(error)) throw error;
    throw new ArtifactInputError(error);
  }
}

export async function renderHistoricalFrame(request: RenderRequest): Promise<RenderArtifact[]> {
  const { HeadlessEnvironmentPainter } = await import('./HeadlessEnvironmentPainter');
  const { HeadlessChartPainter } = await import('./HeadlessChartPainter');
  const painters = [
    new HeadlessEnvironmentPainter({ capturesDir: '.' }),
    new HeadlessChartPainter({ capturesDir: '.' }),
  ];
  const artifacts: RenderArtifact[] = [];
  const errors: RenderBatchError['errors'] = [];
  for (const painter of painters) {
    try {
      artifacts.push(...((await painter.render(request)) ?? []));
    } catch (error) {
      if (error instanceof RenderBatchError) {
        artifacts.push(...error.artifacts);
        errors.push(...error.errors);
      } else errors.push({ painterId: painter.id, code: 'render_failed', message: String(error) });
    }
  }
  if (!artifacts.length && !errors.length)
    errors.push({
      painterId: '*',
      code: 'render_missing',
      message: 'No render artifacts were produced.',
    });
  if (errors.length) throw new RenderBatchError(artifacts, errors);
  return artifacts;
}

export async function exportRecordingFrame(
  path: string,
  selection: RecordingSelection,
  output: string,
  options: {
    snapshotId?: string;
    envIds?: string[];
    chartIds?: string[];
    renderOptions?: SceneRenderOptions;
  } = {},
) {
  const document = await readRecording(path, options.snapshotId);
  const position = selectRecordingFrame(document.snapshot, selection);
  const frame = frameFromRecording(document.snapshot, position.frame);
  if (document.origin) frame.source = { kind: 'recording', ...document.origin };
  return saveCapturedFrame(frame, output, { ...options, render: renderHistoricalFrame });
}

export async function renderRecordingFrame(
  path: string,
  selection: RecordingSelection,
  options: SceneRenderOptions,
  snapshotId?: string,
) {
  const document = await readRecording(path, snapshotId);
  const position = selectRecordingFrame(document.snapshot, selection);
  const frame = frameFromRecording(document.snapshot, position.frame);
  const artifacts = await renderHistoricalFrame(
    fixedRenderRequest(frame.scene, options, 'recording'),
  );
  return { position, artifacts: artifacts.map(({ data: _data, ...artifact }) => artifact) };
}
