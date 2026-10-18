import type {
  ActionInvokePayload,
  ActionResultPayload,
  RendererToSimulatorMessage,
  StateSyncBeginPayload,
  StateSyncEndPayload,
} from '@tensnap/protocol';
import { ProtocolValidationError } from '@tensnap/protocol';
import type { Scenario } from '../scenario';
import type { RecordingOptions as SnapshotRecordingOptions } from '../snapshot';
import { cloneRecordingOptions } from '../snapshot/recording-options';
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

export type RunStopReason =
  | 'condition'
  | 'condition-error'
  | 'max-steps'
  | 'wall-time'
  | 'action-timeout'
  | 'action-error'
  | 'render-error'
  | 'validation-error'
  | 'simulator'
  | 'paused'
  | 'stopped'
  | 'disconnected';

export interface RunActionOutcome {
  id: string;
  requestId: string;
  source: 'action' | 'lifecycle';
  timeBefore?: number;
  timeAfter?: number;
  result: ActionResultPayload;
}

export interface RunStatus {
  id: string;
  spec: RunRequest;
  state: 'running' | 'paused' | 'stopped';
  /** @deprecated Use completedActions. Retained for the public run API. */
  completedSteps: number;
  dispatchedActions: number;
  completedActions: number;
  succeededActions: number;
  failedActions: number;
  stopReasons: RunStopReason[];
  primaryFailure?: RunStopReason;
  settled: boolean;
  settledAt?: number;
  stateKnown: boolean;
  lastAction?: RunActionOutcome;
  lastLifecycleAction?: RunActionOutcome;
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
  /** Resolve only after the host has rendered or persisted this action's visible result. */
  wait(task: RuntimeTaskSnapshot, payload: ActionResultPayload): void | Promise<void>;
}

export interface RunControllerOptions {
  scenario: Scenario;
  send(message: RendererToSimulatorMessage): void;
  scheduler?: RunScheduler;
  renderBarrier?: RunRenderBarrier;
  actionTimeoutMs?: number;
  onActionTimeout?: (task: RuntimeTaskSnapshot) => void;
  /** Fired after the matching action has passed the host render barrier. */
  onActionRendered?: (
    payload: Pick<ActionResultPayload, 'id' | 'request_id'> & { renderError?: string },
  ) => void;
  /** Observability hook for host rendering failures; errors are never left unhandled. */
  onRenderBarrierError?: (
    error: unknown,
    task: RuntimeTaskSnapshot,
    payload: ActionResultPayload,
  ) => void;
  maxStepsPolicy?: number;
  idFactory?: () => string;
  onStateChange?: (status: RunStatus | null) => void;
  onRunStart?: (status: RunStatus) => void;
  onRunStop?: (status: RunStatus) => void;
  /** Fired after the final action, lifecycle and host barriers have ended. */
  onRunSettled?: (status: RunStatus) => void;
}

const nativeScheduler: RunScheduler = {
  now: () => performance.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Action results contain primitive fields, flat timing buckets and optional structured error data. */
const cloneActionResult = (payload: ActionResultPayload): ActionResultPayload => ({
  ...payload,
  ...(payload.timings ? { timings: { ...payload.timings } } : {}),
  ...(payload.error
    ? {
        error:
          payload.error.data === undefined ? { ...payload.error } : structuredClone(payload.error),
      }
    : {}),
});

const cloneOutcome = (outcome: RunActionOutcome): RunActionOutcome => ({
  ...outcome,
  result: cloneActionResult(outcome.result),
});

const cloneRunSpec = (spec: RunRequest): RunRequest => ({
  ...spec,
  ...(spec.record ? { record: cloneRecordingOptions(spec.record) } : {}),
});

const cloneStatus = (status: RunStatus): RunStatus => {
  return {
    ...status,
    spec: cloneRunSpec(status.spec),
    ...(typeof status.conditionValue === 'object' && status.conditionValue !== null
      ? { conditionValue: structuredClone(status.conditionValue) }
      : {}),
    stopReasons: [...status.stopReasons],
    ...(status.lastAction ? { lastAction: cloneOutcome(status.lastAction) } : {}),
    ...(status.lastLifecycleAction
      ? { lastLifecycleAction: cloneOutcome(status.lastLifecycleAction) }
      : {}),
  };
};

export function validateRunSpec(spec: RunRequest, maxStepsPolicy: number): RunRequest {
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
    throw new Error(
      `BoundedRunSpec.maxSteps exceeds the configured policy limit (${maxStepsPolicy}).`,
    );
  }
  if (
    spec.maxWallTimeMs !== undefined &&
    (!Number.isFinite(spec.maxWallTimeMs) || spec.maxWallTimeMs <= 0)
  ) {
    throw new Error('RunRequest.maxWallTimeMs must be a positive finite number when specified.');
  }
  return cloneRunSpec(spec);
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
  private readonly retainedRuns = new Map<string, RunStatus>();
  private readonly settledListeners = new Set<(status: RunStatus) => void>();
  private readonly renderErrors = new Map<string, string>();
  private readonly taskOwners = new Map<
    string,
    { runId: string; source: 'action' | 'lifecycle'; timeBefore?: number }
  >();
  private resetting = false;
  private condition: CompiledRunCondition | null = null;
  private deadlineHandle: unknown | null = null;
  private actionTimeoutHandle: unknown | null = null;
  private actionTimeoutScheduledAt: number | null = null;
  private actionTimeoutDeadlineAt: number | null = null;
  private actionTimeoutTaskId: string | null = null;
  private actionTimeoutMs: number;
  private readonly invocationByTaskId = new Map<
    string,
    Pick<ActionInvokePayload, 'target' | 'kwargs'>
  >();

  constructor(private readonly options: RunControllerOptions) {
    this.scheduler = options.scheduler ?? nativeScheduler;
    this.maxStepsPolicy = options.maxStepsPolicy ?? DEFAULT_RUN_MAX_STEPS;
    if (!Number.isInteger(this.maxStepsPolicy) || this.maxStepsPolicy < 1) {
      throw new Error('maxStepsPolicy must be a positive integer.');
    }
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.actionTimeoutMs = this.normalizeActionTimeout(options.actionTimeoutMs ?? 5_000);
    this.runtime = new PipelineRuntime({
      now: () => this.scheduler.now(),
      idFactory: this.idFactory,
    });
  }

  get status(): RunStatus | null {
    return this.activeRun === null ? null : cloneStatus(this.activeRun);
  }

  /** Last 100 settled summaries are retained; active runs are always available. */
  getRun(id: string): RunStatus | null {
    const status = this.activeRun?.id === id ? this.activeRun : this.retainedRuns.get(id);
    return status ? cloneStatus(status) : null;
  }

  waitForSettled(id: string, timeoutMs = 30_000, signal?: AbortSignal): Promise<RunStatus> {
    const status = this.getRun(id);
    if (!status) return Promise.reject(new Error(`Unknown or expired run: ${id}`));
    if (status.settled) return Promise.resolve(status);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      return Promise.reject(new Error('timeoutMs must be positive.'));
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.scheduler.clearTimeout(timer);
        this.settledListeners.delete(onSettled);
        signal?.removeEventListener('abort', onAbort);
      };
      const onSettled = (result: RunStatus) => {
        if (result.id !== id) return;
        cleanup();
        resolve(cloneStatus(result));
      };
      const onAbort = () => {
        cleanup();
        reject(new Error(`Wait for run ${id} aborted; operation was not cancelled.`));
      };
      const timer = this.scheduler.setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for run ${id}; operation was not cancelled.`));
      }, timeoutMs);
      this.settledListeners.add(onSettled);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }

  get isRunning(): boolean {
    return this.activeRun?.state === 'running';
  }

  get isPaused(): boolean {
    return this.activeRun?.state === 'paused';
  }

  /** True while any simulator action, including the lifecycle stop hook, is active. */
  /** Gate future dispatch without stopping or settling the run. Release is idempotent. */
  holdActionBoundary(): () => void {
    const release = this.runtime.holdDispatch();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      release();
      this.flushCommands();
    };
  }

  get hasInFlightAction(): boolean {
    return this.runtime.peekActiveTaskRef() !== null;
  }

  setActionTimeoutMs(timeoutMs: number): void {
    this.actionTimeoutMs = this.normalizeActionTimeout(timeoutMs);
    const activeTask = this.runtime.peekActiveTaskRef();
    if (activeTask?.stage === 'dispatched') this.scheduleActionTimeout(activeTask);
  }

  requestStateSync(requestId: string): boolean {
    return this.runtime.requestStateSync(requestId);
  }

  recordStateSyncBoundary(
    phase: 'begin' | 'end',
    payload: StateSyncBeginPayload | StateSyncEndPayload,
  ): boolean {
    const accepted = this.runtime.recordStateSyncBoundary(phase, payload);
    if (accepted && phase === 'end') this.flushCommands();
    return accepted;
  }

  abortStateSync(requestId: string): boolean {
    const accepted = this.runtime.abortStateSync(requestId);
    if (accepted) this.flushCommands();
    return accepted;
  }

  requestAction(
    actionId: string,
    continuous = false,
    invocation: Pick<ActionInvokePayload, 'target' | 'kwargs'> = {},
  ): string {
    // Detach before queue mutation: a failed copy must leave the current operation intact.
    const ownedInvocation =
      invocation.target !== undefined || invocation.kwargs !== undefined
        ? structuredClone(invocation)
        : undefined;
    if (!continuous) {
      this.discardInvocations(this.runtime.cancel());
      this.finish('stopped');
    }
    const taskId = this.runtime.enqueue(actionId, { continuous });
    if (ownedInvocation) this.invocationByTaskId.set(taskId, ownedInvocation);
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
    const normalized = validateRunSpec(spec, this.maxStepsPolicy);
    const condition =
      normalized.mode === 'bounded' && normalized.stopWhen !== undefined
        ? compileRunCondition(normalized.stopWhen)
        : null;
    // Reject a new run before changing the existing one. A caller can retry
    // once the current tick has passed its render barrier.
    if (
      this.resetting ||
      this.runtime.peekActiveTaskRef() ||
      (this.activeRun && !this.activeRun.settled)
    ) {
      throw new Error('Wait for the current action tick to finish before starting another run.');
    }
    this.stop('stopped');
    if (this.runtime.peekActiveTaskRef()) {
      throw new Error('Wait for the current action tick to finish before starting another run.');
    }
    this.condition = condition;
    const status: RunStatus = {
      id: this.idFactory(),
      spec: normalized,
      state: 'running',
      completedSteps: 0,
      dispatchedActions: 0,
      completedActions: 0,
      succeededActions: 0,
      failedActions: 0,
      stopReasons: [],
      settled: false,
      stateKnown: true,
      startedAt: this.scheduler.now(),
      pauseRequested: false,
      inFlight: false,
    };
    const previous = this.activeRun;
    this.activeRun = status;
    try {
      this.options.onRunStart?.(cloneStatus(status));
    } catch (error) {
      this.activeRun = previous;
      this.condition = null;
      throw error;
    }

    if (normalized.mode === 'bounded' && this.evaluateCondition()) {
      this.finish(status.conditionError ? 'condition-error' : 'condition');
      return this.status!;
    }

    if (normalized.maxWallTimeMs !== undefined) {
      this.deadlineHandle = this.scheduler.setTimeout(
        () => this.finish('wall-time'),
        normalized.maxWallTimeMs,
      );
    }

    this.discardInvocations(this.runtime.cancel());
    this.runtime.enqueue(normalized.actionId, { continuous: true });
    this.flushCommands();
    status.inFlight = this.runtime.peekActiveTaskRef()?.key === normalized.actionId;
    this.publish();
    return this.status!;
  }

  stop(reason: RunStopReason = 'stopped'): RunStatus | null {
    if (!this.activeRun || this.activeRun.settled) return this.status;
    this.finish(reason);
    return this.status;
  }

  reset(reason: RunStopReason = 'disconnected'): void {
    this.resetting = true;
    try {
      if (this.activeRun && !this.activeRun.settled && this.hasInFlightAction)
        this.activeRun.stateKnown = false;
      this.finish(reason);
      this.clearActionTimeout();
      this.runtime.reset();
      this.taskOwners.clear();
      this.renderErrors.clear();
      this.invocationByTaskId.clear();
      this.options.scenario.endResetLifecycle();
    } finally {
      this.resetting = false;
    }
    this.maybeSettle();
  }

  matchesActiveAction(payload: Pick<ActionResultPayload, 'id' | 'request_id'>): boolean {
    return this.matchActiveTask(payload) !== null;
  }

  actionSource(
    payload: Pick<ActionResultPayload, 'id' | 'request_id'>,
  ): 'action' | 'lifecycle' | undefined {
    const task = this.matchActiveTask(payload);
    return task ? this.taskOwners.get(task.id)?.source : undefined;
  }

  observeActionResult(payload: ActionResultPayload): boolean {
    const task = this.matchActiveTask(payload);
    if (!task) return false;

    this.releaseActionTimeout(task);

    if (
      !this.runtime.completeTask(task.id, {
        should_continue: payload.should_continue,
        timings: payload.timings,
      })
    ) {
      return false;
    }
    if (task.key === 'reset') this.options.scenario.endResetLifecycle();
    this.runtime.markTaskApplied(task.id);

    const run = this.activeRun;
    const owner = this.taskOwners.get(task.id);
    if (run && owner?.runId === run.id) {
      const outcome: RunActionOutcome = {
        id: task.key,
        requestId: task.id,
        source: owner.source,
        timeBefore: owner.timeBefore,
        timeAfter: this.options.scenario.time,
        result: cloneActionResult(payload),
      };
      if (owner.source === 'action') {
        run.lastAction = outcome;
        run.completedActions += 1;
        run.completedSteps = run.completedActions;
        if (payload.error !== undefined) run.failedActions += 1;
        else run.succeededActions += 1;
        const conditionMatched =
          run.state === 'running' && run.spec.mode === 'bounded' && this.evaluateCondition();
        const reasons: RunStopReason[] = [];
        if (run.conditionError) reasons.push('condition-error');
        if (payload.error !== undefined) reasons.push('action-error');
        if (run.pauseRequested) reasons.push('paused');
        if (conditionMatched && !run.conditionError) reasons.push('condition');
        if (run.spec.mode === 'bounded' && run.completedActions >= run.spec.maxSteps)
          reasons.push('max-steps');
        if (payload.should_continue === false) reasons.push('simulator');
        for (const reason of reasons) this.finish(reason);
      } else {
        run.lastLifecycleAction = outcome;
        if (payload.error !== undefined) this.finish('action-error');
      }
    }

    if (payload.error !== undefined || payload.should_continue === false) {
      this.discardInvocations(this.runtime.cancel(task.key));
    }

    const renderBarrier = this.options.renderBarrier;
    if (renderBarrier) {
      void Promise.resolve()
        .then(() => renderBarrier.wait(task, payload))
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
      this.taskOwners.delete(task.id);
      // Close the owning run before sending a queued action that belongs to another operation.
      const settled = this.maybeSettle();
      this.flushCommands();
      if (!settled && this.activeRun && !this.activeRun.settled) {
        const activeTask = this.runtime.peekActiveTaskRef();
        this.activeRun.inFlight = activeTask
          ? this.taskOwners.get(activeTask.id)?.runId === this.activeRun.id
          : false;
        this.publish();
      }
      const renderError = this.renderErrors.get(task.id);
      this.renderErrors.delete(task.id);
      this.options.onActionRendered?.({ ...payload, ...(renderError ? { renderError } : {}) });
    }
    return rendered;
  }

  cancelContinuousActions(actionId?: string): void {
    this.discardInvocations(this.runtime.cancel(actionId));
  }

  private evaluateCondition(): boolean {
    if (!this.activeRun || this.activeRun.spec.mode !== 'bounded' || !this.condition) return false;
    try {
      const value = this.condition.evaluate(
        createRunConditionScope(this.options.scenario, this.activeRun.completedActions),
      );
      this.activeRun.conditionValue = structuredClone(value);
      return value === true;
    } catch (error) {
      this.activeRun.conditionError = error instanceof Error ? error.message : String(error);
      return true;
    }
  }

  private finish(reason: RunStopReason): void {
    const run = this.activeRun;
    if (!run || run.settled) return;
    if (!run.stopReasons.includes(reason)) run.stopReasons.push(reason);
    const failures: RunStopReason[] = [
      'disconnected',
      'action-timeout',
      'validation-error',
      'action-error',
      'condition-error',
      'render-error',
    ];
    run.primaryFailure = failures.find((failure) => run.stopReasons.includes(failure));
    run.stopReason = run.primaryFailure ?? run.stopReasons[0];
    if (run.state !== 'running') {
      this.publish();
      return;
    }
    if (this.deadlineHandle !== null) {
      this.scheduler.clearTimeout(this.deadlineHandle);
      this.deadlineHandle = null;
    }
    // An in-flight simulator action still needs its timeout during cleanup.
    this.discardInvocations(this.runtime.cancel(run.spec.actionId));
    run.state = reason === 'paused' ? 'paused' : 'stopped';
    run.stoppedAt = this.scheduler.now();
    this.condition = null;
    if (
      reason !== 'disconnected' &&
      reason !== 'validation-error' &&
      reason !== 'action-timeout' &&
      this.canInvokeStopHook(run.spec.actionId)
    ) {
      const taskId = this.runtime.enqueueFront('stop');
      this.taskOwners.set(taskId, { runId: run.id, source: 'lifecycle' });
    }
    run.inFlight = this.hasInFlightAction;
    this.publish();
    this.options.onRunStop?.(cloneStatus(run));
    this.flushCommands();
    this.maybeSettle();
  }

  private maybeSettle(): boolean {
    const run = this.activeRun;
    if (
      this.resetting ||
      !run ||
      run.state === 'running' ||
      run.settled ||
      [...this.taskOwners.values()].some((owner) => owner.runId === run.id)
    )
      return false;
    run.inFlight = false;
    run.settled = true;
    run.settledAt = this.scheduler.now();
    if (!this.hasInFlightAction) this.clearActionTimeout();
    this.retainedRuns.set(run.id, cloneStatus(run));
    while (this.retainedRuns.size > 100)
      this.retainedRuns.delete(this.retainedRuns.keys().next().value!);
    this.options.onRunSettled?.(cloneStatus(run));
    this.publish();
    for (const listener of this.settledListeners) listener(run);
    return true;
  }

  private matchActiveTask(
    payload: Pick<ActionResultPayload, 'id' | 'request_id'>,
  ): RuntimeTaskSnapshot | null {
    const activeTask = this.runtime.peekActiveTaskRef();
    if (!activeTask) return null;
    return activeTask.id === payload.request_id && activeTask.key === payload.id
      ? activeTask
      : null;
  }

  private flushCommands(): void {
    const commands = this.runtime.consumeCommands();
    for (const command of commands) {
      if (command.type !== 'dispatch') continue;
      const invocation = this.invocationByTaskId.get(command.task.id);
      this.invocationByTaskId.delete(command.task.id);
      const run = this.activeRun;
      if (run && !run.settled) {
        const source =
          this.taskOwners.get(command.task.id)?.source ??
          (run.state === 'running' && command.task.key === run.spec.actionId
            ? 'action'
            : undefined);
        if (source) {
          this.taskOwners.set(command.task.id, {
            runId: run.id,
            source,
            timeBefore: this.options.scenario.time,
          });
          if (source === 'action') run.dispatchedActions += 1;
        }
      }
      const isReset = command.task.key === 'reset';
      if (isReset) this.options.scenario.beginResetLifecycle();
      try {
        this.options.send(
          this.options.scenario.createActionInvokeMessage(command.task.key, command.task.id, {
            continuous: command.task.continuous,
            ...invocation,
          }),
        );
      } catch (error) {
        if (isReset) this.options.scenario.endResetLifecycle();
        // The dispatch never reached the simulator. Release the task instead
        // of leaving the pipeline wedged until its normal action timeout.
        this.runtime.cancelPendingDispatch(command.task.id);
        const owner = this.taskOwners.get(command.task.id);
        this.taskOwners.delete(command.task.id);
        if (error instanceof ProtocolValidationError) {
          if (run && owner?.source === 'action') run.dispatchedActions -= 1;
          this.finish('validation-error');
        } else {
          if (run) run.stateKnown = false;
          this.finish('disconnected');
        }
        throw error;
      }
      if (
        this.runtime.peekActiveTaskRef()?.id === command.task.id &&
        this.runtime.peekActiveTaskRef()?.stage === 'dispatched'
      )
        this.scheduleActionTimeout(command.task);
    }
  }

  private scheduleActionTimeout(task: RuntimeTaskSnapshot): void {
    if (this.actionTimeoutMs <= 0) {
      this.clearActionTimeout();
      return;
    }
    this.actionTimeoutTaskId = task.id;
    this.actionTimeoutDeadlineAt = this.scheduler.now() + this.actionTimeoutMs;
    this.armActionTimeout(this.actionTimeoutDeadlineAt);
  }

  private armActionTimeout(deadline: number): void {
    // During a continuous run, the previous deadline is always no later than
    // the next action's deadline. Reuse that timer and check the current task
    // when it fires instead of installing and cancelling one timer per tick.
    if (
      this.actionTimeoutHandle !== null &&
      this.actionTimeoutScheduledAt !== null &&
      this.actionTimeoutScheduledAt <= deadline
    )
      return;
    if (this.actionTimeoutHandle !== null) this.scheduler.clearTimeout(this.actionTimeoutHandle);
    const now = this.scheduler.now();
    const delay = Math.max(1, deadline - now);
    this.actionTimeoutScheduledAt = now + delay;
    this.actionTimeoutHandle = this.scheduler.setTimeout(() => this.checkActionTimeout(), delay);
  }

  private checkActionTimeout(): void {
    this.actionTimeoutHandle = null;
    this.actionTimeoutScheduledAt = null;
    const taskId = this.actionTimeoutTaskId;
    const deadline = this.actionTimeoutDeadlineAt;
    if (taskId === null || deadline === null) return;
    const activeTask = this.runtime.peekActiveTaskRef();
    if (!activeTask || activeTask.id !== taskId || activeTask.stage !== 'dispatched') {
      this.clearActionTimeout();
      return;
    }
    if (this.scheduler.now() < deadline) {
      this.armActionTimeout(deadline);
      return;
    }
    this.clearActionTimeout();
    this.options.onActionTimeout?.(activeTask);
    this.runtime.completeTask(activeTask.id, { should_continue: false });
    if (activeTask.key === 'reset') this.options.scenario.endResetLifecycle();
    this.runtime.markTaskApplied(activeTask.id);
    if (this.activeRun && this.taskOwners.get(activeTask.id)?.runId === this.activeRun.id) {
      this.activeRun.stateKnown = false;
      this.finish('action-timeout');
    } else {
      this.discardInvocations(this.runtime.cancel(activeTask.key));
    }
    this.discardInvocations(this.runtime.cancel());
    if (this.runtime.markTaskRendered(activeTask.id)) this.invocationByTaskId.delete(activeTask.id);
    this.taskOwners.delete(activeTask.id);
    this.flushCommands();
    this.maybeSettle();
  }

  private releaseActionTimeout(task: RuntimeTaskSnapshot): void {
    if (this.actionTimeoutTaskId !== task.id) return;
    this.actionTimeoutTaskId = null;
    this.actionTimeoutDeadlineAt = null;
    if (this.activeRun?.state !== 'running' || this.activeRun.spec.actionId !== task.key) {
      this.clearActionTimeout();
    }
  }

  private clearActionTimeout(taskId?: string): void {
    if (taskId !== undefined && this.actionTimeoutTaskId !== taskId) return;
    if (this.actionTimeoutHandle !== null) {
      this.scheduler.clearTimeout(this.actionTimeoutHandle);
      this.actionTimeoutHandle = null;
    }
    this.actionTimeoutScheduledAt = null;
    this.actionTimeoutDeadlineAt = null;
    this.actionTimeoutTaskId = null;
  }

  private normalizeActionTimeout(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 5_000;
    return Math.max(1, Math.floor(value));
  }

  private discardInvocations(taskIds: readonly string[]): void {
    for (const taskId of taskIds) {
      this.invocationByTaskId.delete(taskId);
      this.taskOwners.delete(taskId);
    }
  }

  private canInvokeStopHook(runActionId: string): boolean {
    if (runActionId === 'stop' || this.runtime.hasContinuousKey('stop')) return false;
    const stopAction = this.options.scenario.getAction('stop');
    return (
      stopAction !== undefined &&
      (stopAction.scope === undefined || stopAction.scope === 'model') &&
      !stopAction.kwargs?.some((argument) => argument.required === true)
    );
  }

  private handleRenderBarrierError(
    error: unknown,
    task: RuntimeTaskSnapshot,
    payload: ActionResultPayload,
  ): void {
    if (this.runtime.peekActiveTaskRef()?.id !== task.id) return;
    this.renderErrors.set(task.id, error instanceof Error ? error.message : String(error));
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
    if (
      activeTask?.id !== task.id ||
      !this.activeRun ||
      this.taskOwners.get(task.id)?.runId !== this.activeRun.id
    )
      return;
    this.activeRun.renderError = error instanceof Error ? error.message : String(error);
    this.finish('render-error');
  }

  private publish(): void {
    this.options.onStateChange?.(this.status);
  }
}
