import type {
  ActionInvokePayload,
  ActionResultPayload,
  RendererToSimulatorMessage,
  StateSyncBeginPayload,
  StateSyncEndPayload,
} from '@tensnap/protocol';
import type { Scenario } from '../scenario';
import type { RecordingOptions as SnapshotRecordingOptions } from '../snapshot';
import { PipelineRuntime } from './PipelineRuntime';
import type { RuntimeTaskSnapshot } from './TaskQueue';
import {
  compileRunCondition,
  createRunConditionScope,
  type CompiledRunCondition,
} from './ScenarioConditionScope';

export const DEFAULT_RUN_MAX_STEPS = 1_000_000;

export interface RecordingOptions extends SnapshotRecordingOptions {}

export interface BoundedRunSpec {
  mode: 'bounded';
  actionId: string;
  maxSteps: number;
  stopWhen?: string;
  maxWallTimeMs?: number;
  record?: RecordingOptions | false;
}

export interface ManualRunSpec {
  mode: 'manual';
  actionId: string;
  maxWallTimeMs?: number;
  record?: RecordingOptions | false;
}

export type RunRequest = BoundedRunSpec | ManualRunSpec;

export type RunStopReason = 'condition' | 'condition-error' | 'max-steps' | 'wall-time' | 'action-timeout' | 'action-error' | 'render-error' | 'simulator' | 'paused' | 'stopped' | 'disconnected';

export interface RunStatus {
  id: string;
  spec: RunRequest;
  state: 'running' | 'paused' | 'stopped';
  completedSteps: number;
  startedAt: number;
  stoppedAt?: number;
  stopReason?: RunStopReason;
  conditionValue?: unknown;
  conditionError?: string;
  /** Error reported by the host render barrier for the final completed tick. */
  renderError?: string;
  /** Pause has been requested; an already-dispatched action is allowed to finish. */
  pauseRequested: boolean;
  /** True while the simulator/render barrier still owns the current tick. */
  inFlight: boolean;
}

export interface RunScheduler {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface RunRenderBarrier {
  wait(task: RuntimeTaskSnapshot, payload: ActionResultPayload): void | Promise<void>;
}

export interface RunControllerOptions {
  scenario: Scenario;
  send(message: RendererToSimulatorMessage): void;
  scheduler?: RunScheduler;
  renderBarrier?: RunRenderBarrier;
  actionTimeoutMs?: number;
  onActionTimeout?: (task: RuntimeTaskSnapshot) => void;
  /** Observability hook for host rendering failures; errors are never left unhandled. */
  onRenderBarrierError?: (error: unknown, task: RuntimeTaskSnapshot, payload: ActionResultPayload) => void;
  maxStepsPolicy?: number;
  idFactory?: () => string;
  onStateChange?: (status: RunStatus | null) => void;
  onRunStart?: (status: RunStatus) => void;
  onRunStop?: (status: RunStatus) => void;
}

const nativeScheduler: RunScheduler = {
  now: () => performance.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const cloneStatus = (status: RunStatus): RunStatus => {
  // The common non-recording run contains only primitives. Avoid invoking the
  // structured-clone machinery for every status read and every completed tick.
  // Complex condition/recording payloads keep the stronger deep-copy boundary.
  if (
    status.spec.record
    || (typeof status.conditionValue === 'object' && status.conditionValue !== null)
  ) {
    return structuredClone(status);
  }
  return { ...status, spec: { ...status.spec } };
};

function validateRunSpec(spec: RunRequest, maxStepsPolicy: number): RunRequest {
  if (spec.mode !== 'bounded' && spec.mode !== 'manual') {
    throw new Error("RunRequest.mode must be either 'bounded' or 'manual'.");
  }
  if (typeof spec.actionId !== 'string' || !spec.actionId.trim()) {
    throw new Error('RunRequest.actionId must not be empty.');
  }
  if (spec.mode === 'bounded' && (!Number.isInteger(spec.maxSteps) || spec.maxSteps < 1)) {
    throw new Error('BoundedRunSpec.maxSteps must be a positive integer.');
  }
  if (spec.mode === 'bounded' && spec.maxSteps > maxStepsPolicy) {
    throw new Error(`BoundedRunSpec.maxSteps exceeds the configured policy limit (${maxStepsPolicy}).`);
  }
  if (spec.maxWallTimeMs !== undefined && (!Number.isFinite(spec.maxWallTimeMs) || spec.maxWallTimeMs <= 0)) {
    throw new Error('RunRequest.maxWallTimeMs must be a positive finite number when specified.');
  }
  return structuredClone(spec);
}

/**
 * Host-neutral renderer-driven execution controller. It owns the shared
 * PipelineRuntime lifecycle; browser and Node only provide a clock, timer and
 * (when needed) a render barrier.
 */
export class RunController {
  private readonly runtime: PipelineRuntime;
  private readonly scheduler: RunScheduler;
  private readonly maxStepsPolicy: number;
  private readonly idFactory: () => string;
  private activeRun: RunStatus | null = null;
  private condition: CompiledRunCondition | null = null;
  private deadlineHandle: unknown | null = null;
  private actionTimeoutHandle: unknown | null = null;
  private actionTimeoutTaskId: string | null = null;
  private actionTimeoutMs: number;
  private readonly invocationByTaskId = new Map<string, Pick<ActionInvokePayload, 'target' | 'kwargs'>>();

  constructor(private readonly options: RunControllerOptions) {
    this.scheduler = options.scheduler ?? nativeScheduler;
    this.maxStepsPolicy = options.maxStepsPolicy ?? DEFAULT_RUN_MAX_STEPS;
    if (!Number.isInteger(this.maxStepsPolicy) || this.maxStepsPolicy < 1) {
      throw new Error('maxStepsPolicy must be a positive integer.');
    }
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.actionTimeoutMs = this.normalizeActionTimeout(options.actionTimeoutMs ?? 5_000);
    this.runtime = new PipelineRuntime({ now: () => this.scheduler.now(), idFactory: this.idFactory });
  }

  get status(): RunStatus | null {
    return this.activeRun === null ? null : cloneStatus(this.activeRun);
  }

  get isRunning(): boolean {
    return this.activeRun?.state === 'running';
  }

  get isPaused(): boolean {
    return this.activeRun?.state === 'paused';
  }

  setActionTimeoutMs(timeoutMs: number): void {
    this.actionTimeoutMs = this.normalizeActionTimeout(timeoutMs);
    const activeTask = this.runtime.peekActiveTaskRef();
    if (activeTask?.stage === 'dispatched') this.scheduleActionTimeout(activeTask);
  }

  requestStateSync(requestId: string): boolean {
    return this.runtime.requestStateSync(requestId);
  }

  recordStateSyncBoundary(phase: 'begin' | 'end', payload: StateSyncBeginPayload | StateSyncEndPayload): boolean {
    const accepted = this.runtime.recordStateSyncBoundary(phase, payload);
    if (accepted && phase === 'end') this.flushCommands();
    return accepted;
  }

  requestAction(
    actionId: string,
    continuous = false,
    invocation: Pick<ActionInvokePayload, 'target' | 'kwargs'> = {},
  ): string {
    if (!continuous) {
      this.finish('stopped');
      this.discardInvocations(this.runtime.cancel());
    }
    const taskId = this.runtime.enqueue(actionId, { continuous });
    if (invocation.target !== undefined || invocation.kwargs !== undefined) this.invocationByTaskId.set(taskId, invocation);
    this.flushCommands();
    return taskId;
  }

  /** Pause a run without fabricating a simulator domain action. */
  pause(): RunStatus | null {
    const run = this.activeRun;
    if (!run || run.state !== 'running') return this.status;
    run.pauseRequested = true;
    this.discardInvocations(this.runtime.cancel(run.spec.actionId));
    const activeTask = this.runtime.peekActiveTaskRef();
    run.inFlight = activeTask?.key === run.spec.actionId;
    if (!run.inFlight) this.finish('paused');
    else this.publish();
    return this.status;
  }

  /** Pause first, then enqueue exactly one model action behind any in-flight tick. */
  requestStep(actionId: string): string {
    this.pause();
    return this.requestOneShot(actionId);
  }

  /** Reset is still a model action; the host owns confirmation/history policy. */
  requestReset(actionId: string): string {
    this.pause();
    return this.requestOneShot(actionId);
  }

  private requestOneShot(actionId: string): string {
    const taskId = this.runtime.enqueue(actionId, { continuous: false });
    this.flushCommands();
    return taskId;
  }

  start(spec: RunRequest): RunStatus {
    this.stop('stopped');
    if (this.runtime.peekActiveTaskRef()) {
      throw new Error('Wait for the current action tick to finish before starting another run.');
    }
    const normalized = validateRunSpec(spec, this.maxStepsPolicy);
    this.condition = normalized.mode === 'bounded' && normalized.stopWhen !== undefined
      ? compileRunCondition(normalized.stopWhen)
      : null;
    const status: RunStatus = {
      id: this.idFactory(),
      spec: normalized,
      state: 'running',
      completedSteps: 0,
      startedAt: this.scheduler.now(),
      pauseRequested: false,
      inFlight: false,
    };
    this.activeRun = status;
    this.options.onRunStart?.(cloneStatus(status));

    if (normalized.mode === 'bounded' && this.evaluateCondition()) {
      this.finish('condition');
      return this.status!;
    }

    if (normalized.maxWallTimeMs !== undefined) {
      this.deadlineHandle = this.scheduler.setTimeout(() => this.finish('wall-time'), normalized.maxWallTimeMs);
    }

    this.discardInvocations(this.runtime.cancel());
    this.runtime.enqueue(normalized.actionId, { continuous: true });
    this.flushCommands();
    status.inFlight = this.runtime.peekActiveTaskRef()?.key === normalized.actionId;
    this.publish();
    return this.status!;
  }

  stop(reason: RunStopReason = 'stopped'): RunStatus | null {
    if (!this.activeRun || this.activeRun.state !== 'running') return this.status;
    this.finish(reason);
    return this.status;
  }

  reset(reason: RunStopReason = 'disconnected'): void {
    this.finish(reason);
    this.clearActionTimeout();
    this.runtime.reset();
    this.invocationByTaskId.clear();
  }

  observeActionResult(payload: ActionResultPayload): boolean {
    const task = this.matchActiveTask(payload);
    if (!task) return false;

    this.clearActionTimeout(task.id);

    if (!this.runtime.completeTask(task.id, { should_continue: payload.should_continue, timings: payload.timings })) {
      return false;
    }
    this.runtime.markTaskApplied(task.id);

    const run = this.activeRun;
    if (run?.state === 'running' && task.key === run.spec.actionId) {
      run.completedSteps += 1;
      const conditionMatched = run.spec.mode === 'bounded' && this.evaluateCondition();
      if (run.pauseRequested) {
        this.finish('paused');
      } else if (conditionMatched) {
        this.finish('condition');
      } else if (run.spec.mode === 'bounded' && run.completedSteps >= run.spec.maxSteps) {
        this.finish('max-steps');
      } else if (payload.error !== undefined) {
        this.finish('action-error');
      } else if (payload.should_continue === false) {
        this.finish('simulator');
      }
    }

    if (payload.error !== undefined || payload.should_continue === false) {
      this.discardInvocations(this.runtime.cancel(task.key));
    }

    if (this.options.renderBarrier) {
      void Promise.resolve(this.options.renderBarrier.wait(task, payload))
        .catch((error: unknown) => this.handleRenderBarrierError(error, task, payload))
        .then(() => this.markActionRendered(payload));
    }
    return true;
  }

  markActionRendered(payload: Pick<ActionResultPayload, 'id' | 'request_id'>): boolean {
    const task = this.matchActiveTask(payload);
    if (!task) return false;
    const rendered = this.runtime.markTaskRendered(task.id);
    if (rendered) {
      this.invocationByTaskId.delete(task.id);
      this.flushCommands();
      if (this.activeRun && this.activeRun.spec.actionId === task.key) {
        this.activeRun.inFlight = this.runtime.peekActiveTaskRef()?.key === this.activeRun.spec.actionId;
        this.publish();
      }
    }
    return rendered;
  }

  cancelContinuousActions(actionId?: string): void {
    this.discardInvocations(this.runtime.cancel(actionId));
  }

  private evaluateCondition(): boolean {
    if (!this.activeRun || this.activeRun.spec.mode !== 'bounded' || !this.condition) return false;
    try {
      const value = this.condition.evaluate(createRunConditionScope(this.options.scenario, this.activeRun.completedSteps));
      this.activeRun.conditionValue = structuredClone(value);
      return value === true;
    } catch (error) {
      this.activeRun.conditionError = error instanceof Error ? error.message : String(error);
      this.finish('condition-error');
      return true;
    }
  }

  private finish(reason: RunStopReason): void {
    const run = this.activeRun;
    if (!run || run.state === 'stopped') return;
    if (this.deadlineHandle !== null) {
      this.scheduler.clearTimeout(this.deadlineHandle);
      this.deadlineHandle = null;
    }
    this.clearActionTimeout();
    this.discardInvocations(this.runtime.cancel(run.spec.actionId));
    run.state = reason === 'paused' ? 'paused' : 'stopped';
    run.stopReason = reason;
    run.stoppedAt = this.scheduler.now();
    run.inFlight = this.runtime.peekActiveTaskRef()?.key === run.spec.actionId;
    this.condition = null;
    this.publish();
    this.options.onRunStop?.(cloneStatus(run));
  }

  private matchActiveTask(payload: Pick<ActionResultPayload, 'id' | 'request_id'>): RuntimeTaskSnapshot | null {
    const activeTask = this.runtime.peekActiveTaskRef();
    if (!activeTask) return null;
    return activeTask.id === payload.request_id ? activeTask : null;
  }

  private flushCommands(): void {
    const commands = this.runtime.consumeCommands();
    for (const command of commands) {
      if (command.type !== 'dispatch') continue;
      const invocation = this.invocationByTaskId.get(command.task.id);
      this.invocationByTaskId.delete(command.task.id);
      this.options.send(this.options.scenario.createActionInvokeMessage(
        command.task.key,
        command.task.id,
        { continuous: command.task.continuous, ...invocation },
      ));
      this.scheduleActionTimeout(command.task);
    }
  }

  private scheduleActionTimeout(task: RuntimeTaskSnapshot): void {
    this.clearActionTimeout();
    if (this.actionTimeoutMs <= 0) return;
    this.actionTimeoutTaskId = task.id;
    this.actionTimeoutHandle = this.scheduler.setTimeout(() => {
      if (this.actionTimeoutTaskId !== task.id) return;
      const activeTask = this.runtime.peekActiveTaskRef();
      if (!activeTask || activeTask.id !== task.id || activeTask.stage !== 'dispatched') return;
      this.clearActionTimeout();
      this.options.onActionTimeout?.(activeTask);
      this.runtime.completeTask(activeTask.id, { should_continue: false });
      this.runtime.markTaskApplied(activeTask.id);
      if (this.activeRun?.state === 'running' && this.activeRun.spec.actionId === activeTask.key) {
        this.finish('action-timeout');
      } else {
        this.discardInvocations(this.runtime.cancel(activeTask.key));
      }
      if (this.runtime.markTaskRendered(activeTask.id)) this.invocationByTaskId.delete(activeTask.id);
      this.flushCommands();
    }, this.actionTimeoutMs);
  }

  private clearActionTimeout(taskId?: string): void {
    if (taskId !== undefined && this.actionTimeoutTaskId !== taskId) return;
    if (this.actionTimeoutHandle !== null) {
      this.scheduler.clearTimeout(this.actionTimeoutHandle);
      this.actionTimeoutHandle = null;
    }
    this.actionTimeoutTaskId = null;
  }

  private normalizeActionTimeout(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 5_000;
    return Math.max(1, Math.floor(value));
  }

  private discardInvocations(taskIds: readonly string[]): void {
    for (const taskId of taskIds) this.invocationByTaskId.delete(taskId);
  }

  private handleRenderBarrierError(error: unknown, task: RuntimeTaskSnapshot, payload: ActionResultPayload): void {
    try {
      this.options.onRenderBarrierError?.(error, task, payload);
    } catch {
      // Observability hooks must not turn a handled host-render failure back
      // into an unhandled Promise rejection.
    }

    // A rejection must not leave a continuous run stalled behind an unresolved
    // render gate. Only stop the run that still owns this exact task; a later
    // run may already have superseded it while the host was rendering.
    const activeTask = this.runtime.peekActiveTaskRef();
    if (activeTask?.id !== task.id || this.activeRun?.state !== 'running') return;
    this.activeRun.renderError = error instanceof Error ? error.message : String(error);
    this.finish('render-error');
  }

  private publish(): void {
    this.options.onStateChange?.(this.status);
  }
}
