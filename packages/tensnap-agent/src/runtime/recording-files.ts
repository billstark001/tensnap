import { NodeRecordingStore } from './NodeRecordingStore';
import type { ScenarioQuery } from '@tensnap/core/scenario';
import { ArtifactInputError, isFileSystemFailure } from './artifact-errors';
import { readFile, stat } from 'node:fs/promises';
import {
  RecordingStoreReader,
  decodePersistenceValue,
  parseProjectFileContent,
  parseRecordingFile,
  selectRecordingFrame,
  inspectRecording,
  type RecordingDocument,
  type RecordingSelection,
} from '@tensnap/core/persistence';
import { frameFromRecording, queryRecording, exactValueEqual } from '@tensnap/core/snapshot';
import type { SceneRenderOptions } from '../types';
import { fixedRenderRequest, saveCapturedFrame } from './frame-files';
import { renderPainterBatch, type RenderArtifact, type RenderRequest } from './painter';

/** One pinned reader is shared for the duration of an operation, including batches. */
export async function withRecordingStore<T>(
  path: string,
  callback: (reader: RecordingStoreReader) => Promise<T>,
): Promise<T> {
  const backend = new NodeRecordingStore(path);
  const reader = await RecordingStoreReader.open(backend);
  try {
    return await callback(reader);
  } finally {
    await reader.close();
    backend.close();
  }
}
export async function isRecordingStore(path: string) {
  return (await stat(path)).isDirectory();
}
export async function readRecordingBoundary(
  path: string,
  selection: RecordingSelection,
  snapshotId?: string,
) {
  selection = { ...selection };
  if (await isRecordingStore(path)) {
    if (snapshotId) throw new ArtifactInputError('--snapshot-id requires a project file.');
    return withRecordingStore(path, async (reader) => {
      const position = await reader.select(selection);
      return { position, frame: await reader.readFrame(position.frame!) };
    });
  }
  const document = await readRecording(path, snapshotId);
  const position = selectRecordingFrame(document.snapshot, selection);
  return { position, frame: frameFromRecording(document.snapshot, position.frame) };
}
export async function inspectRecordingBoundary(
  path: string,
  selection: RecordingSelection,
  query?: ScenarioQuery,
  snapshotId?: string,
) {
  selection = { ...selection };
  query = structuredClone(query);
  if (await isRecordingStore(path)) {
    if (snapshotId) throw new ArtifactInputError('--snapshot-id requires a project file.');
    return withRecordingStore(path, async (reader) => {
      const position = await reader.select(selection);
      return { position, ...(query ? { query: await reader.query(position.frame!, query) } : {}) };
    });
  }
  const document = await readRecording(path, snapshotId);
  const position = selectRecordingFrame(document.snapshot, selection);
  return {
    position,
    ...(query ? { query: queryRecording(document.snapshot, position.frame, query) } : {}),
  };
}

export async function monitorStoreHistory(
  path: string,
  options: {
    monitorId: string;
    from: number;
    to: number;
    sampling: 'boundaries' | 'changes';
    fields?: ScenarioQuery['fields'];
    limit?: number;
    after?: number;
  },
) {
  options = structuredClone(options);
  const limit = options.limit ?? 100;
  if (
    !Number.isSafeInteger(options.from) ||
    options.from < 0 ||
    !Number.isSafeInteger(options.to) ||
    options.to < options.from ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 1000
  )
    throw new ArtifactInputError('Invalid monitor history range/page.');
  return withRecordingStore(path, async (reader) => {
    const samples = [];
    let previous: unknown;
    let hasPrevious = false;
    let continuation: number | undefined;
    for await (const position of reader.locations(options.from, options.to)) {
      const sample = await reader.query(position.frame!, {
        selector: { kind: 'monitor', id: options.monitorId },
        fields: options.fields,
      });
      const changed = !hasPrevious || !exactValueEqual(previous, sample.items);
      previous = sample.items;
      hasPrevious = true;
      if (options.after !== undefined && position.frame! <= options.after) continue;
      if (options.sampling === 'changes' && !changed) continue;
      if (samples.length === limit) {
        continuation = samples[samples.length - 1].location.frame;
        break;
      }
      samples.push(sample);
    }
    const gaps = [];
    if (options.from < reader.root.firstFrame)
      gaps.push({
        from: options.from,
        to: Math.min(options.to, reader.root.firstFrame - 1),
        reason: 'not-retained',
      });
    if (options.to > reader.root.lastFrame)
      gaps.push({
        from: Math.max(options.from, reader.root.lastFrame + 1),
        to: options.to,
        reason: 'not-observed',
      });
    return {
      version: 1,
      sourceId: reader.root.id,
      generation: reader.root.generation,
      requested: { from: options.from, to: options.to },
      retained: { from: reader.root.firstFrame, to: reader.root.lastFrame },
      sampling: options.sampling,
      samples,
      gaps,
      truncated: continuation !== undefined,
      continuation,
    };
  });
}

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
  return renderPainterBatch(painters, request);
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
  selection = { ...selection };
  options = structuredClone(options);
  const { frame } = await readRecordingBoundary(path, selection, options.snapshotId);
  return saveCapturedFrame(frame, output, { ...options, render: renderHistoricalFrame });
}

export async function renderRecordingFrame(
  path: string,
  selection: RecordingSelection,
  options: SceneRenderOptions,
  snapshotId?: string,
) {
  selection = { ...selection };
  options = structuredClone(options);
  const { frame, position } = await readRecordingBoundary(path, selection, snapshotId);
  const artifacts = await renderHistoricalFrame(
    fixedRenderRequest(frame.scene, options, 'recording'),
  );
  return { position, artifacts: artifacts.map(({ data: _data, ...artifact }) => artifact) };
}
