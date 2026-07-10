import type { ScenarioSnapshot } from '@tensnap/core';
import { createSingleSnapshot, type Snapshot } from '@tensnap/core/snapshot';
import {
  ActionEndPayloadSchema,
  ActionSchema,
  AssetMetaSchema,
  ChartMetadataSchema,
  LogLevelSchema,
  ParameterSchema,
  RendererToSimulatorMessageSchema,
  SimulatorToRendererMessageSchema,
} from '@tensnap/protocol';
import { z } from 'zod';
import { ContainerView } from "./ui";

export const PROJECT_FILE_VERSION = 1;

const UnknownRecordSchema = z.record(z.string(), z.unknown());

const ScenarioLayerSnapshotSchema = z.object({
  id: z.string(),
  layerType: z.string(),
  metadata: UnknownRecordSchema,
  dependencyLayerIds: z.record(z.string(), z.string()),
  storageSnapshot: z.unknown(),
});

const ScenarioSnapshotSchema = z.object({
  metadata: UnknownRecordSchema,
  actions: z.array(ActionSchema),
  parameters: z.array(ParameterSchema),
  environments: z.array(z.object({
    id: z.string(),
    type: z.enum(['uniform', '2d']),
    layers: z.array(ScenarioLayerSnapshotSchema),
  })),
  charts: z.array(z.object({
    id: z.string(),
    label: z.string(),
    metadataDict: z.record(z.string(), ChartMetadataSchema),
    data: z.array(z.object({ time: z.number() }).catchall(z.union([z.number(), z.string()]))),
  })),
  logs: z.array(z.object({
    message: z.string(),
    level: LogLevelSchema,
    target: z.string().optional(),
    timestamp: z.number(),
    data: z.unknown().optional(),
  })),
  assets: z.array(z.object({
    meta: AssetMetaSchema,
    data: z.union([z.string(), z.instanceof(Uint8Array)]).optional(),
  })),
});

const SnapshotKeyframeSchema = z.object({
  frame: z.number().int().nonnegative(),
  timestamp: z.number(),
  scenario: ScenarioSnapshotSchema,
});

const SnapshotSchema = z.object({
  version: z.literal(1),
  metadata: z.object({
    id: z.string(),
    createdAt: z.number(),
    endedAt: z.number().optional(),
    label: z.string().optional(),
  }),
  initial: SnapshotKeyframeSchema,
  keyframes: z.array(SnapshotKeyframeSchema),
  frames: z.array(z.object({
    index: z.number().int().positive(),
    timestamp: z.number(),
    messages: z.array(SimulatorToRendererMessageSchema),
    controls: z.array(RendererToSimulatorMessageSchema),
    action: ActionEndPayloadSchema.optional(),
    kind: z.enum(['action', 'control', 'sync']),
  })),
  layerCodecs: z.record(z.string(), z.enum(['delta', 'keyframe', 'adaptive', 'derived'])),
  byteLength: z.number().nonnegative(),
  truncated: z.boolean(),
});

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
    type: z.enum(['environment', 'parameter', 'chart']),
    data: z.object({
      id: z.string(),
      title: z.string().optional(),
      type: z.string().optional(),
    }),
  }),
  BaseViewSchema.extend({
    type: z.literal('container'),
    data: z.object({ title: z.string() }),
    views: z.array(AnyViewSchema),
  }),
]));

const ProjectFileSchema = z.object({
  version: z.literal(PROJECT_FILE_VERSION),
  url: z.string(),
  mainView: AnyViewSchema,
  scenario: ScenarioSnapshotSchema,
  snapshots: z.array(SnapshotSchema),
});

const LegacyProjectFileSchema = z.object({
  url: z.string(),
  mainView: AnyViewSchema,
  scenario: ScenarioSnapshotSchema,
  snapshots: z.array(ScenarioSnapshotSchema).optional(),
});

export interface ProjectSettings {
  maxSnapshots: number;
}

export interface ProjectFileContent {
  version: typeof PROJECT_FILE_VERSION;
  url: string;
  mainView: ContainerView;
  scenario: ScenarioSnapshot;
  snapshots: Snapshot[];
}

/**
 * Validates the on-disk project format and upgrades the version-0 shape.
 * Version-zero files have no `version` field and used one-off
 * ScenarioSnapshot entries, so each becomes a directly loadable recording
 * with a single initial keyframe.
 */
export function parseProjectFileContent(value: unknown): ProjectFileContent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid project file: expected an object.');
  }
  const project = value as Record<string, unknown>;

  if (Object.prototype.hasOwnProperty.call(project, 'version')) {
    if (project.version !== PROJECT_FILE_VERSION) {
      throw new Error(`Unsupported project file version: ${String(project.version)}.`);
    }
    return ProjectFileSchema.parse(project) as ProjectFileContent;
  }

  const legacy = LegacyProjectFileSchema.parse(project);
  return {
    version: PROJECT_FILE_VERSION,
    url: legacy.url,
    mainView: legacy.mainView as ContainerView,
    scenario: legacy.scenario as ScenarioSnapshot,
    snapshots: (legacy.snapshots ?? []).map((snapshot) => createSingleSnapshot(snapshot as ScenarioSnapshot)),
  };
}

export const defaultProjectSettings = (): ProjectSettings => ({
  maxSnapshots: 32,
});
