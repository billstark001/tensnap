import type { ScenarioSnapshot } from '@tensnap/core';
import {
  createSingleSnapshot,
  decodeSnapshotArchive,
  encodeSnapshotArchive,
  isSnapshotArchive,
  snapshotArchiveForJson,
  type Snapshot,
  type SnapshotArchive,
  type SnapshotModelIdentity,
} from '@tensnap/core/snapshot';
import { encodeBytesAsDataUrl } from '@tensnap/protocol';
import { encodeSnapshotArchivesInWorker } from '@/workers/snapshot-archive';
import {
  ActionResultPayloadSchema,
  ActionSchema,
  AssetMetaSchema,
  ChartMetadataSchema,
  LogLevelSchema,
  ParameterSchema,
  MonitorMetadataSchema,
  ProtocolValueSchema,
  RendererToSimulatorMessageSchema,
  SimulatorToRendererMessageSchema,
} from '@tensnap/protocol';
import { z } from 'zod';
import type { ContainerView } from "./ui";
import { createDefaultRootLayout } from '@/utils/view/create-view';
import type { ProjectSource } from '@tensnap/core/snapshot';

export const PROJECT_FILE_VERSION = 3;
/**
 * Persistence compatibility promise: TenSnap Web accepts every released
 * project format from the unversioned v0 shape through v2 and upgrades it to
 * PROJECT_FILE_VERSION in memory. Saving always writes only the current form.
 */
export const MIGRATABLE_PROJECT_FILE_VERSIONS = [0, 1, 2] as const;

const UnknownRecordSchema = z.record(z.string(), z.unknown());

const ScenarioLayerSnapshotSchema = z.object({
  id: z.string(),
  layerType: z.string(),
  metadata: UnknownRecordSchema,
  dependencyLayerIds: z.record(z.string(), z.string()),
  storageSnapshot: z.unknown(),
});

const ScenarioEnvironmentSnapshotSchema = z.object({
  id: z.string(),
  type: z.enum(['uniform', '2d']),
  layers: z.array(ScenarioLayerSnapshotSchema),
});

const ChartGroupSnapshotSchema = z.object({
  id: z.string(),
  label: z.string(),
  metadataDict: z.record(z.string(), ChartMetadataSchema),
  data: z.array(z.object({ time: z.number() }).catchall(z.union([z.number(), z.string()]))),
});

const LogSnapshotSchema = z.object({
  message: z.string(),
  level: LogLevelSchema,
  target: z.string().optional(),
  timestamp: z.number(),
  data: z.unknown().optional(),
});

const AssetSnapshotSchema = z.object({
  meta: AssetMetaSchema,
  data: z.union([z.string(), z.instanceof(Uint8Array)]).optional(),
});

const ScenarioSnapshotSchema = z.object({
  metadata: UnknownRecordSchema,
  actions: z.array(ActionSchema),
  parameters: z.array(ParameterSchema),
  environments: z.array(ScenarioEnvironmentSnapshotSchema),
  charts: z.array(ChartGroupSnapshotSchema),
  monitors: z.array(MonitorMetadataSchema.extend({
    value: ProtocolValueSchema.optional(),
    revision: z.union([z.string(), z.number()]).optional(),
  })).default([]),
  logs: z.array(LogSnapshotSchema),
  assets: z.array(AssetSnapshotSchema),
});

const SnapshotKeyframeSchema = z.object({
  frame: z.number().int().nonnegative(),
  timestamp: z.number(),
  scenario: ScenarioSnapshotSchema,
});

const SnapshotModelIdentitySchema = z.object({
  model_id: z.string().min(1),
  state_schema_version: z.string().optional(),
  instance_id: z.string().min(1).optional(),
});

const SnapshotCheckpointSchema = z.object({
  encoding: z.string().min(1),
  data: z.union([z.string(), z.instanceof(Uint8Array)]),
  model_id: z.string().min(1),
  state_schema_version: z.string().optional(),
});

const SnapshotMetadataSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  // MessagePack serializes explicit `undefined` object properties as null.
  // Accept existing files and normalize them back to the optional shape.
  endedAt: z.number().nullable().optional().transform((value) => value ?? undefined),
  label: z.string().nullable().optional().transform((value) => value ?? undefined),
  model_identity: SnapshotModelIdentitySchema.optional(),
  checkpoint: SnapshotCheckpointSchema.optional(),
});

const SnapshotSchema = z.object({
  version: z.literal(1),
  metadata: SnapshotMetadataSchema,
  initial: SnapshotKeyframeSchema,
  keyframes: z.array(SnapshotKeyframeSchema),
  frames: z.array(z.object({
    index: z.number().int().positive(),
    timestamp: z.number(),
    messages: z.array(SimulatorToRendererMessageSchema),
    controls: z.array(RendererToSimulatorMessageSchema),
    action: ActionResultPayloadSchema.nullable().optional().transform((value) => value ?? undefined),
    kind: z.enum(['action', 'control', 'sync']),
  })),
  layerCodecs: z.record(z.string(), z.enum(['delta', 'keyframe', 'adaptive', 'derived'])),
  byteLength: z.number().nonnegative(),
  truncated: z.boolean(),
});

const SnapshotArchiveSchema = z.object({
  version: z.literal(1),
  metadata: SnapshotMetadataSchema,
  layerCodecs: z.record(z.string(), z.enum(['delta', 'keyframe', 'adaptive', 'derived'])),
  segments: z.array(z.object({
    firstFrame: z.number().int().nonnegative(),
    lastFrame: z.number().int().nonnegative(),
    encoding: z.literal('msgpack'),
    compression: z.enum(['none', 'rle']),
    data: z.union([z.string(), z.instanceof(Uint8Array)]),
    byteLength: z.number().nonnegative(),
  })).min(1),
  byteLength: z.number().nonnegative(),
  truncated: z.boolean(),
});

// Version-zero projects may contain either their original one-off scenario
// snapshots or recordings created before the project file version was added.
const LegacySnapshotSchema = z.union([ScenarioSnapshotSchema, SnapshotSchema]);

const BaseViewSchema = z.object({
  id: z.string(),
  left: z.number(),
  top: z.number(),
  width: z.number(),
  height: z.number(),
  expanded: z.boolean(),
  disabled: z.boolean(),
});

const AnyViewSchema: z.ZodType = z.lazy(() => z.union([
  BaseViewSchema.extend({
    type: z.literal('button'),
    data: z.object({
      id: z.string(),
      text: z.string(),
      continuous: z.boolean().optional(),
    }),
  }),
  BaseViewSchema.extend({
    type: z.enum(['environment', 'parameter', 'chart', 'monitor']),
    data: z.object({
      id: z.string(),
      title: z.string().optional(),
      type: z.string().optional(),
      renderHint: z.enum(['auto', 'tree', 'table', 'text']).optional(),
    }),
  }),
  BaseViewSchema.extend({
    type: z.literal('container'),
    data: z.object({ title: z.string() }),
    views: z.array(AnyViewSchema),
  }),
]));

const ProjectAssetBlobSchema = z.object({
  mime: z.string(),
  data: z.union([z.string(), z.instanceof(Uint8Array)]),
});

const isWebSocketUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') && parsed.host.length > 0;
  } catch {
    return false;
  }
};

export const ProjectSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('websocket'), url: z.string().refine(isWebSocketUrl, 'Expected a non-empty ws:// or wss:// URL.') }).strict(),
  z.object({ kind: z.literal('inmemory'), model_id: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('snapshot'), snapshot_id: z.string().min(1) }).strict(),
]);

const ProjectFileSchema = z.object({
  version: z.literal(PROJECT_FILE_VERSION),
  source: ProjectSourceSchema,
  model_identity: SnapshotModelIdentitySchema.optional(),
  mainView: AnyViewSchema,
  scenario: ScenarioSnapshotSchema,
  /** Archives are decoded by core after structural project validation. */
  snapshots: z.array(SnapshotArchiveSchema),
  assetTable: z.record(z.string(), ProjectAssetBlobSchema),
});

const VersionTwoProjectFileSchema = z.object({
  version: z.literal(2),
  url: z.string(),
  mainView: AnyViewSchema,
  scenario: ScenarioSnapshotSchema,
  snapshots: z.array(z.unknown()),
  assetTable: z.record(z.string(), ProjectAssetBlobSchema),
});

const VersionOneProjectFileSchema = z.object({
  version: z.literal(1),
  url: z.string(),
  mainView: AnyViewSchema,
  scenario: ScenarioSnapshotSchema,
  snapshots: z.array(SnapshotSchema),
});

const LegacyProjectFileSchema = z.object({
  url: z.string(),
  mainView: AnyViewSchema,
  scenario: ScenarioSnapshotSchema,
  snapshots: z.array(LegacySnapshotSchema).optional(),
});

export interface ProjectFileContent {
  version: typeof PROJECT_FILE_VERSION;
  source: ProjectSource;
  model_identity?: SnapshotModelIdentity;
  mainView: ContainerView;
  scenario: ScenarioSnapshot;
  snapshots: Snapshot[];
}

export interface ProjectFileArchive {
  version: typeof PROJECT_FILE_VERSION;
  source: ProjectSource;
  model_identity?: SnapshotModelIdentity;
  mainView: ContainerView;
  scenario: ScenarioSnapshot;
  snapshots: SnapshotArchive[];
  /** Content-addressed binary payloads shared by the live state and recordings. */
  assetTable: Record<string, { mime: string; data: string | Uint8Array }>;
}

export interface ProjectRecovery {
  content: ProjectFileContent;
  warnings: string[];
}

const asRecord = (value: unknown): Record<string, unknown> | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

function recoverArray<T>(
  value: unknown,
  schema: z.ZodType<T>,
  label: string,
  warnings: string[],
): T[] {
  if (!Array.isArray(value)) {
    warnings.push(`${label} was missing or malformed and was reset.`);
    return [];
  }
  const result: T[] = [];
  let discarded = 0;
  for (const entry of value) {
    const parsed = schema.safeParse(entry);
    if (parsed.success) result.push(parsed.data);
    else discarded += 1;
  }
  if (discarded > 0) warnings.push(`${discarded} invalid ${label} entr${discarded === 1 ? 'y was' : 'ies were'} skipped.`);
  return result;
}

function recoverScenarioSnapshot(value: unknown, warnings: string[], label: string): ScenarioSnapshot | null {
  const strict = ScenarioSnapshotSchema.safeParse(value);
  if (strict.success) return strict.data as ScenarioSnapshot;

  const source = asRecord(value);
  if (!source) return null;
  warnings.push(`${label} was partially recovered.`);
  const metadata = UnknownRecordSchema.safeParse(source.metadata);
  const recovered = {
    metadata: metadata.success ? metadata.data : {},
    actions: recoverArray(source.actions, ActionSchema, `${label} actions`, warnings),
    parameters: recoverArray(source.parameters, ParameterSchema, `${label} parameters`, warnings),
    environments: recoverArray(source.environments, ScenarioEnvironmentSnapshotSchema, `${label} environments`, warnings),
    charts: recoverArray(source.charts, ChartGroupSnapshotSchema, `${label} charts`, warnings),
    monitors: recoverArray(source.monitors, MonitorMetadataSchema.extend({
      value: ProtocolValueSchema.optional(),
      revision: z.union([z.string(), z.number()]).optional(),
    }), `${label} monitors`, warnings),
    logs: recoverArray(source.logs, LogSnapshotSchema, `${label} logs`, warnings),
    assets: recoverArray(source.assets, AssetSnapshotSchema, `${label} assets`, warnings),
  };
  const parsed = ScenarioSnapshotSchema.safeParse(recovered);
  return parsed.success ? parsed.data as ScenarioSnapshot : null;
}

function recoverRecordingSnapshot(value: unknown, warnings: string[], index: number): Snapshot | null {
  const recorded = SnapshotSchema.safeParse(value);
  if (recorded.success) return recorded.data as Snapshot;

  const oneOff = ScenarioSnapshotSchema.safeParse(value);
  if (oneOff.success) {
    warnings.push(`Snapshot ${index + 1} used the legacy format and was migrated.`);
    return createSingleSnapshot(oneOff.data as ScenarioSnapshot);
  }

  const source = asRecord(value);
  const initial = source ? SnapshotKeyframeSchema.safeParse(source.initial) : null;
  if (!initial?.success) {
    warnings.push(`Snapshot ${index + 1} could not be recovered and was skipped.`);
    return null;
  }
  const metadata = asRecord(source?.metadata);
  warnings.push(`Snapshot ${index + 1} was recovered from its initial state; its timeline was discarded.`);
  return createSingleSnapshot(initial.data.scenario as ScenarioSnapshot, {
    id: typeof metadata?.id === 'string' ? metadata.id : undefined,
    label: typeof metadata?.label === 'string' ? metadata.label : undefined,
    timestamp: typeof metadata?.createdAt === 'number' ? metadata.createdAt : undefined,
  });
}

type ProjectAssetTable = ProjectFileArchive['assetTable'];

function sameAssetData(left: string | Uint8Array, right: string | Uint8Array): boolean {
  if (typeof left === 'string' || typeof right === 'string') return left === right;
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function storeAsset(
  table: ProjectAssetTable,
  hash: string,
  mime: string,
  data: string | Uint8Array,
): void {
  const existing = table[hash];
  if (existing && (existing.mime !== mime || !sameAssetData(existing.data, data))) {
    throw new Error(`Project asset hash collision for ${hash}.`);
  }
  table[hash] = { mime, data: typeof data === 'string' ? data : data.slice() };
}

function extractScenarioAssets(snapshot: ScenarioSnapshot, table: ProjectAssetTable): ScenarioSnapshot {
  const next = structuredClone(snapshot);
  next.assets = next.assets.map((asset) => {
    if (asset.data !== undefined) storeAsset(table, asset.meta.hash, asset.meta.mime, asset.data);
    return { ...asset, data: undefined };
  });
  return next;
}

function hydrateScenarioAssets(snapshot: ScenarioSnapshot, table: ProjectAssetTable): ScenarioSnapshot {
  const next = structuredClone(snapshot);
  next.assets = next.assets.map((asset) => ({
    ...asset,
    data: asset.data ?? table[asset.meta.hash]?.data,
  }));
  return next;
}

function extractSnapshotAssets(snapshot: Snapshot, table: ProjectAssetTable): Snapshot {
  const next = structuredClone(snapshot);
  next.initial.scenario = extractScenarioAssets(next.initial.scenario, table);
  for (const keyframe of next.keyframes) keyframe.scenario = extractScenarioAssets(keyframe.scenario, table);
  for (const frame of next.frames) {
    for (const message of frame.messages) {
      if (message.type !== 'asset_data') continue;
      const payload = message.payload as { hash: string; mime: string; data: string | Uint8Array };
      storeAsset(table, payload.hash, payload.mime, payload.data);
      // Frame payloads are rehydrated from the same table before Scenario replay.
      delete (payload as { data?: string | Uint8Array }).data;
    }
  }
  return next;
}

function hydrateSnapshotAssets(snapshot: Snapshot, table: ProjectAssetTable): Snapshot {
  const next = structuredClone(snapshot);
  next.initial.scenario = hydrateScenarioAssets(next.initial.scenario, table);
  for (const keyframe of next.keyframes) keyframe.scenario = hydrateScenarioAssets(keyframe.scenario, table);
  for (const frame of next.frames) {
    for (const message of frame.messages) {
      if (message.type !== 'asset_data') continue;
      const payload = message.payload as { hash: string; data?: string | Uint8Array };
      payload.data ??= table[payload.hash]?.data;
    }
  }
  return next;
}

/**
 * Build the project persistence shape. Snapshot segments and every resolved
 * asset are written once, with snapshots referencing the shared hash table.
 */
export function archiveProjectFileContent(content: ProjectFileContent, jsonSafe = false): ProjectFileArchive {
  const assetTable: ProjectAssetTable = {};
  const snapshots = content.snapshots.map((snapshot) => {
    const archive = encodeSnapshotArchive(extractSnapshotAssets(snapshot, assetTable));
    return jsonSafe ? snapshotArchiveForJson(archive) : archive;
  });
  const scenario = extractScenarioAssets(content.scenario, assetTable);
  const normalizedAssetTable = jsonSafe
    ? Object.fromEntries(Object.entries(assetTable).map(([hash, blob]) => [hash, {
      ...blob,
      data: typeof blob.data === 'string' ? blob.data : encodeBytesAsDataUrl(blob.data, blob.mime),
    }]))
    : assetTable;
  return {
    version: PROJECT_FILE_VERSION,
    source: structuredClone(content.source),
    ...(content.model_identity === undefined ? {} : { model_identity: structuredClone(content.model_identity) }),
    mainView: structuredClone(content.mainView),
    scenario,
    snapshots,
    assetTable: normalizedAssetTable,
  };
}

/** Same archive layout as `archiveProjectFileContent`, with segment encoding in a Worker. */
export async function archiveProjectFileContentInWorker(
  content: ProjectFileContent,
  jsonSafe = false,
): Promise<ProjectFileArchive> {
  const assetTable: ProjectAssetTable = {};
  const snapshots = await encodeSnapshotArchivesInWorker(
    content.snapshots.map((snapshot) => extractSnapshotAssets(snapshot, assetTable)),
    jsonSafe,
  );
  const scenario = extractScenarioAssets(content.scenario, assetTable);
  const normalizedAssetTable = jsonSafe
    ? Object.fromEntries(Object.entries(assetTable).map(([hash, blob]) => [hash, {
      ...blob,
      data: typeof blob.data === 'string' ? blob.data : encodeBytesAsDataUrl(blob.data, blob.mime),
    }]))
    : assetTable;
  return {
    version: PROJECT_FILE_VERSION,
    source: structuredClone(content.source),
    ...(content.model_identity === undefined ? {} : { model_identity: structuredClone(content.model_identity) }),
    mainView: structuredClone(content.mainView),
    scenario,
    snapshots,
    assetTable: normalizedAssetTable,
  };
}

function decodeProjectArchive(archive: ProjectFileArchive): ProjectFileContent {
  const snapshots = archive.snapshots.map((snapshot, index) => {
    try {
      return hydrateSnapshotAssets(decodeSnapshotArchive(snapshot), archive.assetTable);
    } catch (error) {
      throw new Error(
        `Invalid snapshot archive ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  });
  if (archive.source.kind === 'snapshot') {
    const snapshotId = archive.source.snapshot_id;
    if (!snapshots.some((snapshot) => snapshot.metadata.id === snapshotId)) {
      throw new Error(`Snapshot source ${snapshotId} does not exist in this project.`);
    }
  }
  return {
    version: PROJECT_FILE_VERSION,
    source: archive.source,
    ...(archive.model_identity === undefined ? {} : { model_identity: archive.model_identity }),
    mainView: archive.mainView,
    scenario: hydrateScenarioAssets(archive.scenario, archive.assetTable),
    snapshots,
  };
}

/**
 * Best-effort recovery for a project that failed strict validation. It never
 * tries to interpret a future project version, but preserves every validated
 * scenario section and falls back to a snapshot's initial state when possible.
 */
function sourceFromLegacyUrl(url: string): ProjectSource {
  if (url.startsWith('inmemory:')) {
    return { kind: 'inmemory', model_id: z.string().min(1).parse(url.slice('inmemory:'.length)) };
  }
  const normalized = url.startsWith('http://')
    ? `ws://${url.slice('http://'.length)}`
    : url.startsWith('https://')
      ? `wss://${url.slice('https://'.length)}`
      : url;
  return ProjectSourceSchema.parse({ kind: 'websocket', url: normalized }) as ProjectSource;
}

export function recoverProjectFileContent(value: unknown): ProjectRecovery | null {
  const source = asRecord(value);
  if (!source || (Object.prototype.hasOwnProperty.call(source, 'version') && source.version !== 1 && source.version !== 2 && source.version !== PROJECT_FILE_VERSION)) return null;

  const warnings = ['Project validation failed. Valid data was recovered where possible.'];
  let sourceValue: ProjectSource | null = null;
  const parsedSource = ProjectSourceSchema.safeParse(source.source);
  if (parsedSource.success) {
    sourceValue = parsedSource.data as ProjectSource;
  } else if (typeof source.url === 'string') {
    try {
      sourceValue = sourceFromLegacyUrl(source.url);
    } catch {
      warnings.push('The project connection URL was missing or invalid.');
    }
  } else {
    warnings.push('The project connection URL was missing or invalid.');
  }
  const modelIdentity = SnapshotModelIdentitySchema.safeParse(source.model_identity);
  if (source.model_identity !== undefined && !modelIdentity.success) warnings.push('The stored simulator identity was invalid and was discarded.');
  const scenario = recoverScenarioSnapshot(source.scenario, warnings, 'The main scenario');
  if (!scenario) return null;

  const parsedView = AnyViewSchema.safeParse(source.mainView);
  const mainView = parsedView.success
    ? parsedView.data as ContainerView
    : createDefaultRootLayout();
  if (!parsedView.success) warnings.push('The view layout was invalid and was reset to the default layout.');

  const sourceSnapshots = Array.isArray(source.snapshots) ? source.snapshots : [];
  if (!Array.isArray(source.snapshots)) warnings.push('Snapshots were missing or malformed and were reset.');
  const snapshots = sourceSnapshots.flatMap((snapshot, index) => {
    const recovered = recoverRecordingSnapshot(snapshot, warnings, index);
    return recovered ? [recovered] : [];
  });

  if (sourceValue?.kind === 'snapshot') {
    const snapshotId = sourceValue.snapshot_id;
    if (!snapshots.some((snapshot) => snapshot.metadata.id === snapshotId)) {
      sourceValue = null;
      warnings.push('The selected snapshot source was missing.');
    }
  }
  if (!sourceValue) {
    const fallbackSnapshot = snapshots[0];
    if (!fallbackSnapshot) return null;
    sourceValue = { kind: 'snapshot', snapshot_id: fallbackSnapshot.metadata.id };
    warnings.push('The first recovered snapshot was opened as the offline project source.');
  }

  return {
    content: {
      version: PROJECT_FILE_VERSION,
      source: sourceValue,
      ...(modelIdentity.success ? { model_identity: modelIdentity.data } : {}),
      mainView,
      scenario,
      snapshots,
    },
    warnings,
  };
}

/**
 * Validates the on-disk project format and applies the promised v0/v1/v2
 * migrations. Version-zero files have no `version` field and used one-off
 * ScenarioSnapshot entries, so each becomes a directly loadable recording
 * with a single initial keyframe. Future versions remain strict failures.
 */
export function parseProjectFileContent(value: unknown): ProjectFileContent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid project file: expected an object.');
  }
  const project = value as Record<string, unknown>;

  if (Object.prototype.hasOwnProperty.call(project, 'version')) {
    if (project.version === PROJECT_FILE_VERSION) {
      const archive = ProjectFileSchema.parse(project) as ProjectFileArchive;
      if (!archive.snapshots.every(isSnapshotArchive)) {
        throw new Error('Invalid project file: snapshots must use the segmented archive format.');
      }
      return decodeProjectArchive(archive);
    }
    if (project.version === 2) {
      const versionTwo = VersionTwoProjectFileSchema.parse(project);
      const legacyArchive = {
        ...versionTwo,
        version: PROJECT_FILE_VERSION,
        source: sourceFromLegacyUrl(versionTwo.url),
      };
      return decodeProjectArchive(legacyArchive as ProjectFileArchive);
    }
    if (project.version !== 1) {
      throw new Error(`Unsupported project file version: ${String(project.version)}.`);
    }
    const versionOne = VersionOneProjectFileSchema.parse(project);
    return {
      version: PROJECT_FILE_VERSION,
      source: sourceFromLegacyUrl(versionOne.url),
      mainView: versionOne.mainView as ContainerView,
      scenario: versionOne.scenario as ScenarioSnapshot,
      snapshots: versionOne.snapshots as Snapshot[],
    };
  }

  const legacy = LegacyProjectFileSchema.parse(project);
  return {
    version: PROJECT_FILE_VERSION,
    source: sourceFromLegacyUrl(legacy.url),
    mainView: legacy.mainView as ContainerView,
    scenario: legacy.scenario as ScenarioSnapshot,
    snapshots: (legacy.snapshots ?? []).map((snapshot) => (
      'version' in snapshot && snapshot.version === 1
        ? snapshot as Snapshot
        : createSingleSnapshot(snapshot as ScenarioSnapshot)
    )),
  };
}
