import { z } from 'zod';

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const ArtifactSchema = z
  .object({
    path: z.string().regex(/^[a-zA-Z0-9._%-]+$/),
    sha256: HashSchema,
    kind: z.enum(['environment', 'chart', 'composite']),
    mime: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export const FrameManifestSchema = z
  .object({
    kind: z.literal('tensnap-frame'),
    version: z.literal(1),
    status: z.literal('complete'),
    frameId: z.string().min(1),
    capturedAt: z.number(),
    source: z
      .object({
        kind: z.enum(['live', 'recording']),
        recordingId: z.string().optional(),
        frame: z.number().int().nonnegative().optional(),
        actionRequestId: z.string().optional(),
        modelTime: z.number().optional(),
        commitRevision: z.number().int().nonnegative().optional(),
      })
      .strict(),
    modelIdentity: z
      .object({
        model_id: z.string(),
        state_schema_version: z.string().optional(),
        instance_id: z.string().optional(),
      })
      .strict()
      .optional(),
    consistency: z.enum(['renderer-only', 'aligned', 'unverified']),
    checkpointStatus: z.enum([
      'captured',
      'not-requested',
      'unsupported',
      'unavailable',
      'inconsistent',
    ]),
    checkpointReason: z.string().optional(),
    state: z
      .object({
        path: z.enum(['state.recording.json', 'state.recording.msgpack']),
        sha256: HashSchema,
      })
      .strict(),
    renderOptions: z.record(z.string(), z.unknown()),
    artifacts: z.array(ArtifactSchema),
  })
  .strict();
export type FrameManifest = z.infer<typeof FrameManifestSchema>;
