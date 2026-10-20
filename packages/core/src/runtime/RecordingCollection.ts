import { z } from 'zod';
import { decodeBinaryString } from '@tensnap/protocol';
import type { ActionResultPayload, SimulatorToRendererMessage } from '@tensnap/protocol';
import { exactValueEqual } from '../snapshot/diff/equality';
import type { CapturedFrame, SnapshotFrame } from '../snapshot';
import { queryScenario } from '../scenario/query';
import { ScenarioQuerySchema, type ScenarioQuery } from '../scenario/query-schema';
import type { RecordingStoreWriter } from '../persistence/recording-store';
import { type RecordingStoreRoot } from '../persistence/recording-store';
import {
  compileRunCondition,
  createRunConditionScope,
  type CompiledRunCondition,
} from './ScenarioConditionScope';
import type { RendererSession } from './RendererSession';
import {
  type RendererSessionCommitDetail,
  type RendererSessionMessageDetail,
} from './RendererSession';

const ruleBase = {
  id: z.string().min(1),
  cooldownFrames: z.number().int().nonnegative().default(0),
};
export const CollectionConfigSchema = z
  .object({
    version: z.literal(1),
    mode: z.enum(['full-history', 'rolling']),
    maxFrames: z.number().int().positive().optional(),
    maxSegmentBytes: z
      .number()
      .int()
      .positive()
      .default(4 * 1024 * 1024),
    maxPendingBytes: z
      .number()
      .int()
      .positive()
      .default(8 * 1024 * 1024),
    maxStoredBytes: z.number().int().positive(),
    maxPendingSegments: z.number().int().positive().default(2),
    cacheBytes: z
      .number()
      .int()
      .positive()
      .default(1024 * 1024),
    liveHistory: z
      .object({ chartPoints: z.number().int().positive(), logs: z.number().int().nonnegative() })
      .strict(),
    rules: z
      .array(
        z.discriminatedUnion('kind', [
          z
            .object({
              ...ruleBase,
              kind: z.literal('action-error'),
              actionId: z.string().min(1).optional(),
            })
            .strict(),
          z
            .object({
              ...ruleBase,
              kind: z.literal('expression'),
              source: z.string().min(1),
              edge: z.enum(['rising', 'level']).default('rising'),
            })
            .strict(),
          z.object({ ...ruleBase, kind: z.literal('change'), query: ScenarioQuerySchema }).strict(),
        ]),
      )
      .max(64)
      .default([]),
    window: z
      .object({
        before: z.number().int().nonnegative().max(1000000),
        after: z.number().int().nonnegative().max(1000000),
      })
      .strict(),
    maxTriggers: z.number().int().min(1).max(10000),
    checkpoints: z
      .object({
        policy: z.enum(['none', 'if-supported', 'required']),
        every: z.number().int().positive().optional(),
        onTrigger: z.boolean(),
        maxCount: z.number().int().nonnegative(),
        maxBytes: z.number().int().nonnegative(),
        overflow: z.enum(['truncate', 'stop', 'fail']),
        requirePreWindow: z.boolean().default(false),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.mode === 'full-history' && value.maxFrames !== undefined)
      ctx.addIssue({ code: 'custom', message: 'maxFrames applies only to rolling collection.' });
    if (value.mode === 'rolling' && value.maxFrames === undefined)
      ctx.addIssue({ code: 'custom', message: 'rolling requires maxFrames.' });
    if (new Set(value.rules.map((rule) => rule.id)).size !== value.rules.length)
      ctx.addIssue({ code: 'custom', message: 'Trigger IDs must be unique.' });
    for (const rule of value.rules)
      if (rule.kind === 'change' && rule.query.cursor)
        ctx.addIssue({
          code: 'custom',
          message: 'Change triggers cannot retain a revision cursor.',
        });
  });
export type CollectionConfig = z.input<typeof CollectionConfigSchema>;
export function validateCollectionConfig(input: unknown) {
  const config = CollectionConfigSchema.parse(input);
  for (const rule of config.rules) if (rule.kind === 'expression') compileRunCondition(rule.source);
  return config;
}
export interface TriggerWindow {
  id: string;
  ruleId: string;
  kind: string;
  runId?: string;
  actionRequestId?: string;
  frame: number;
  modelTime?: number;
  commitRevision: number;
  reason: string;
  requested: { from: number; to: number };
  actual: { from: number; to: number };
  state: 'pending' | 'complete' | 'partial';
  gaps: Array<{ from: number; to: number; reason: string }>;
  checkpoint: CapturedFrame['checkpointStatus'];
  checkpointReason?: string;
}

/** Coordinates evidence at action/render boundaries. It never dispatches an action to fill a window. */
export class RecordingCollection extends EventTarget {
  private readonly config: z.output<typeof CollectionConfigSchema>;
  private readonly compiled = new Map<string, CompiledRunCondition>();
  private readonly previous = new Map<string, unknown>();
  private readonly lastTrigger = new Map<string, number>();
  private windows: TriggerWindow[] = [];
  private checkpointFrames = new Map<number, number>();
  private checkpointCount = 0;
  private checkpointBytes = 0;
  private checkpointTruncated = false;
  private readonly deduplication = { ignoredActionResults: 0, cooldown: 0, budget: 0 };
  private frame = 0;
  private messages: SimulatorToRendererMessage[] = [];
  private chain: Promise<void> = Promise.resolve();
  private pending = false;
  private ended = false;
  private error?: string;
  private closing?: Promise<RecordingStoreRoot | undefined>;
  private activeHistoryFrom = 0;
  private readonly onCommit = (event: Event) =>
    this.commit((event as CustomEvent<RendererSessionCommitDetail>).detail);
  private readonly onMessage = (event: Event) => {
    const message = (event as CustomEvent<RendererSessionMessageDetail>).detail.message;
    if (
      message.type === 'action_result' &&
      !this.session.run.matchesActiveAction(message.payload as ActionResultPayload)
    )
      this.deduplication.ignoredActionResults++;
  };
  private readonly onClose = () =>
    this.fail(new Error('Simulator disconnected during collection.'));
  private constructor(
    private readonly session: RendererSession,
    private readonly writer: RecordingStoreWriter,
    config: CollectionConfig,
  ) {
    super();
    this.config = validateCollectionConfig(config);
    for (const rule of this.config.rules)
      if (rule.kind === 'expression') this.compiled.set(rule.id, compileRunCondition(rule.source));
  }
  static async start(
    session: RendererSession,
    writer: RecordingStoreWriter,
    config: CollectionConfig,
  ) {
    const collection = new RecordingCollection(session, writer, config);
    if (session.run.hasInFlightAction || (session.run.status && !session.run.status.settled))
      throw new Error('Start collection at an idle action boundary.');
    try {
      const initial = await session.captureBoundaryFrame({
        checkpoint: collection.shouldCheckpoint(false)
          ? collection.config.checkpoints.policy
          : 'none',
      });
      collection.retainCheckpoint(initial);
      await collection.append(initial, [], undefined, []);
      collection.initializeChanges();
      session.addEventListener('commit', collection.onCommit);
      session.addEventListener('message', collection.onMessage);
      session.addEventListener('transport:close', collection.onClose);
      return collection;
    } catch (error) {
      writer.abort(error);
      await writer.close().catch(() => {});
      throw error;
    }
  }
  get status() {
    return { ...this.progress, windows: structuredClone(this.windows) };
  }
  /** Compact automatic events and retained run summaries do not duplicate every window. */
  get progress() {
    const writer = this.writer.status;
    const windowCounts = { pending: 0, complete: 0, partial: 0 };
    for (const window of this.windows) windowCounts[window.state]++;
    return structuredClone({
      version: 1,
      recordingId: writer.root?.id,
      observedFrame: this.frame,
      committedFrame: writer.committedFrame,
      pendingBytes: writer.pendingBytes,
      hold: this.pending,
      backpressure: writer.backpressure,
      activeHistoryRange: { from: this.activeHistoryFrom, to: this.frame },
      retainedRange: writer.root
        ? { from: writer.root.firstFrame, to: writer.root.lastFrame }
        : undefined,
      truncated: writer.root?.truncated,
      checkpointTruncated: this.checkpointTruncated,
      deduplication: this.deduplication,
      windowCounts,
      error: this.error,
      state: this.ended
        ? this.error
          ? 'failed'
          : 'complete'
        : this.error
          ? 'failed'
          : 'collecting',
    });
  }
  private location() {
    return {
      kind: 'recording' as const,
      sourceId: this.writer.status.root!.id,
      revision: this.session.commitRevision,
      frame: this.frame,
      modelTime: this.session.scenario.time,
    };
  }
  private changeValues(query: ScenarioQuery) {
    const result = queryScenario(this.session.scenario, query, this.location());
    if (result.truncated)
      throw new Error('Change trigger query is truncated; select fields/objects within its limit.');
    return result.items;
  }
  private initializeChanges() {
    for (const rule of this.config.rules) {
      if (rule.kind === 'change') this.previous.set(rule.id, this.changeValues(rule.query));
      if (rule.kind === 'expression')
        this.previous.set(
          rule.id,
          this.compiled
            .get(rule.id)!
            .evaluate(createRunConditionScope(this.session.scenario, 0)) === true,
        );
    }
  }
  private commit(detail: RendererSessionCommitDetail) {
    if (this.ended || this.error) return;
    const actionMessage = detail.messages.find((message) => message.type === 'action_result');
    const action = actionMessage?.payload as ActionResultPayload | undefined;
    if (action && !this.session.run.matchesActiveAction(action)) {
      return;
    }
    if (this.pending) {
      this.fail(new Error('Autonomous scene updates exceeded the held collection boundary.'));
      return;
    }
    for (const message of structuredClone(detail.messages)) this.messages.push(message);
    // Preserve an action's atomic span. Standalone control/sync commits are visible boundaries too.
    if (!action && this.session.run.hasInFlightAction) return;
    const release = this.session.run.holdActionBoundary();
    this.pending = true;
    const messages = this.messages;
    this.messages = [];
    const actionSource = action ? this.session.run.actionSource(action) : undefined;
    this.chain = this.chain
      .then(async () => {
        this.frame++;
        if (this.config.mode === 'rolling') {
          const first = Math.max(0, this.frame - this.config.maxFrames!);
          for (const [frame, bytes] of this.checkpointFrames)
            if (frame < first) {
              this.checkpointFrames.delete(frame);
              this.checkpointCount--;
              this.checkpointBytes -= bytes;
            }
        }
        const candidates: Array<{ ruleId: string; kind: string; reason: string }> = [];
        for (const rule of this.config.rules) {
          let matched = false;
          if (rule.kind === 'action-error')
            matched = !!action?.error && (!rule.actionId || rule.actionId === action.id);
          else if (rule.kind === 'expression') {
            const current =
              this.compiled
                .get(rule.id)!
                .evaluate(
                  createRunConditionScope(
                    this.session.scenario,
                    this.session.run.status?.completedActions ?? 0,
                  ),
                ) === true;
            matched = current && (rule.edge === 'level' || this.previous.get(rule.id) !== true);
            this.previous.set(rule.id, current);
          } else {
            const current = this.changeValues(rule.query);
            matched = !exactValueEqual(this.previous.get(rule.id), current);
            this.previous.set(rule.id, current);
          }
          if (matched && this.windows.length + candidates.length >= this.config.maxTriggers)
            this.deduplication.budget++;
          else if (
            matched &&
            this.frame - (this.lastTrigger.get(rule.id) ?? -Infinity) <= rule.cooldownFrames
          )
            this.deduplication.cooldown++;
          if (
            matched &&
            this.windows.length + candidates.length < this.config.maxTriggers &&
            this.frame - (this.lastTrigger.get(rule.id) ?? -Infinity) > rule.cooldownFrames
          ) {
            candidates.push({
              ruleId: rule.id,
              kind: rule.kind,
              reason:
                rule.kind === 'action-error'
                  ? action!.error!.message
                  : rule.kind === 'expression'
                    ? rule.source
                    : 'Selected fields changed.',
            });
            this.lastTrigger.set(rule.id, this.frame);
          }
        }
        const checkpoint = this.shouldCheckpoint(candidates.length > 0)
          ? this.config.checkpoints.policy
          : 'none';
        const captured = await this.session.captureBoundaryFrame({ checkpoint });
        this.retainCheckpoint(captured);
        if (captured.checkpointStatus === 'inconsistent')
          throw new Error('Collection checkpoint boundary changed during capture.');
        if (this.error) throw new Error(this.error);
        const firstFrame =
          this.config.mode === 'rolling' ? Math.max(0, this.frame - this.config.maxFrames!) : 0;
        for (const candidate of candidates) {
          const requested = {
            from: Math.max(0, this.frame - this.config.window.before),
            to: this.frame + this.config.window.after,
          };
          const window: TriggerWindow = {
            ...candidate,
            id: crypto.randomUUID(),
            frame: this.frame,
            runId: this.session.run.status?.id,
            actionRequestId: action?.request_id,
            modelTime: captured.source.modelTime,
            commitRevision: captured.source.commitRevision!,
            requested,
            actual: { from: Math.max(firstFrame, requested.from), to: this.frame },
            gaps: [],
            state: this.config.window.after ? 'pending' : 'complete',
            checkpoint: captured.checkpointStatus,
            checkpointReason: captured.checkpointReason,
          };
          if (requested.from < firstFrame)
            window.gaps.push({ from: requested.from, to: firstFrame - 1, reason: 'not-retained' });
          if (!this.config.window.after && window.gaps.length) window.state = 'partial';
          if (this.config.checkpoints.requirePreWindow && window.gaps.length)
            throw new Error(
              'Required pre-window checkpoint unavailable outside the retained range.',
            );
          if (this.config.checkpoints.requirePreWindow)
            for (let index = window.actual.from; index < this.frame; index++) {
              if (!this.checkpointFrames.has(index))
                throw new Error(`Required pre-window checkpoint unavailable at frame ${index}.`);
            }
          this.windows.push(window);
        }
        for (const window of this.windows) {
          if (window.actual.from < firstFrame) {
            const to = Math.min(firstFrame - 1, window.actual.to);
            if (to >= window.actual.from) {
              const gap = window.gaps.find((gap) => gap.reason === 'not-retained');
              if (gap) gap.to = Math.max(gap.to, to);
              else window.gaps.push({ from: window.actual.from, to, reason: 'not-retained' });
              window.actual.from = Math.min(firstFrame, window.actual.to + 1);
              if (window.state === 'complete') window.state = 'partial';
            }
          }
          if (window.state === 'pending') {
            window.actual.to = Math.min(this.frame, window.requested.to);
            if (this.frame >= window.requested.to)
              window.state = window.gaps.length ? 'partial' : 'complete';
          }
        }
        await this.append(
          captured,
          messages,
          action,
          this.windows.filter((window) => window.actual.to === this.frame),
          actionSource,
        );
        if (
          this.config.mode === 'rolling' &&
          this.frame % Math.max(1, Math.min(64, this.config.maxFrames!)) === 0
        )
          await this.writer.collect();
        this.dispatchEvent(new Event('status'));
      })
      .catch((error) => this.fail(error))
      .finally(() => {
        this.pending = false;
        release();
      });
  }
  private shouldCheckpoint(trigger: boolean) {
    const config = this.config.checkpoints;
    const requested =
      (trigger && config.onTrigger) ||
      (config.every !== undefined && this.frame % config.every === 0);
    if (!requested || config.policy === 'none') return false;
    if (this.checkpointCount >= config.maxCount || this.checkpointBytes >= config.maxBytes) {
      this.checkpointTruncated = true;
      if (config.overflow === 'fail') throw new Error('Checkpoint budget exhausted.');
      if (config.overflow === 'stop') {
        if (this.frame === 0)
          throw new Error('Checkpoint budget exhausted before collection dispatch.');
        this.session.run.stop('stopped');
      }
      return false;
    }
    return true;
  }
  private retainCheckpoint(captured: CapturedFrame) {
    if (!captured.checkpoint) return;
    const bytes =
      typeof captured.checkpoint.data === 'string'
        ? decodeBinaryString(captured.checkpoint.data).bytes.length
        : captured.checkpoint.data.length;
    if (
      this.checkpointCount >= this.config.checkpoints.maxCount ||
      this.checkpointBytes + bytes > this.config.checkpoints.maxBytes
    ) {
      this.checkpointTruncated = true;
      if (this.config.checkpoints.overflow === 'fail')
        throw new Error('Atomic checkpoint exceeds retention budget.');
      if (this.config.checkpoints.overflow === 'stop') {
        if (this.frame === 0)
          throw new Error('Checkpoint budget exhausted before collection dispatch.');
        this.session.run.stop('stopped');
      }
      delete captured.checkpoint;
      captured.checkpointStatus = 'unavailable';
      captured.checkpointReason = 'Checkpoint retention budget exhausted.';
      captured.consistency = 'renderer-only';
      return;
    }
    this.checkpointCount++;
    this.checkpointBytes += bytes;
    this.checkpointFrames.set(this.frame, bytes);
  }
  private async append(
    captured: CapturedFrame,
    messages: SimulatorToRendererMessage[],
    action: ActionResultPayload | undefined,
    annotations: TriggerWindow[],
    source?: SnapshotFrame['source'],
  ) {
    await this.writer.append({
      location: {
        kind: 'recording',
        sourceId: this.config.mode,
        revision: captured.source.commitRevision!,
        frame: this.frame,
        modelTime: captured.source.modelTime,
        actionRequestId: action?.request_id,
      },
      timestamp: captured.capturedAt,
      scene: captured.scene,
      checkpoint: captured.checkpoint,
      provenance: captured.source,
      frame: {
        index: this.frame,
        timestamp: captured.capturedAt,
        kind: action ? 'action' : 'control',
        messages,
        controls: [],
        action,
        source,
      },
      annotations,
    });
    this.session.scenario.retainLiveHistory(this.config.liveHistory);
    this.activeHistoryFrom = this.frame;
    // This is only the checkpoint lookup for active trigger windows; archived associations remain immutable.
    if (this.config.mode === 'full-history')
      for (const frame of this.checkpointFrames.keys())
        if (frame < this.frame - this.config.window.before) this.checkpointFrames.delete(frame);
  }
  private fail(error: unknown) {
    this.error ??= error instanceof Error ? error.message : String(error);
    this.session.run.stop('stopped');
    this.dispatchEvent(new Event('status'));
  }
  close(): Promise<RecordingStoreRoot | undefined> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      await this.chain;
      this.ended = true;
      this.session.removeEventListener('commit', this.onCommit);
      this.session.removeEventListener('message', this.onMessage);
      this.session.removeEventListener('transport:close', this.onClose);
      for (const window of this.windows)
        if (window.state === 'pending') {
          window.state = 'partial';
          window.gaps.push({
            from: window.actual.to + 1,
            to: window.requested.to,
            reason: this.error ?? 'Run ended before post-window completed.',
          });
        }
      if (this.error) this.writer.abort(new Error(this.error));
      const root = await this.writer.close({
        config: this.config,
        windows: this.windows,
        error: this.error,
        checkpointTruncated: this.checkpointTruncated,
        deduplication: this.deduplication,
      });
      if (this.error) throw new Error(this.error);
      return root;
    })().catch((error) => {
      this.fail(error);
      throw error;
    });
    return this.closing;
  }
}
