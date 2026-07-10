import type { ActionEndPayload, RendererToSimulatorMessage, StateSyncBoundaryPayload } from '@tensnap/protocol';
import type { Scenario } from '../scenario';
import type { RecordingOptions as SnapshotRecordingOptions } from '../snapshot';
import { PipelineRuntime, type RuntimeTaskSnapshot } from './PipelineRuntime';
import {
  compileRunCondition,
  createRunConditionScope,
  type CompiledRunCondition,
} from './ScenarioConditionScope';

export const DEFAULT_RUN_MAX_STEPS = 1_000_000;
/** A practical stand-in for the legacy "run until stopped" button behavior. */
export const MAX_INT32_RUN_STEPS = 0x7fffffff;

export interface RecordingOptions extends SnapshotRecordingOptions {}

export interface RunSpec {
  actionId: string;
  maxSteps: number;
  stopWhen?: string;
  maxWallTimeMs?: number;
  record?: RecordingOptions | false;
}

export type RunStopReason = 'condition' | 'condition-error' | 'max-steps' | 'wall-time' | 'action-timeout' | 'simulator' | 'stopped' | 'disconnected';

export interface RunStatus {
  id: string;
  spec: RunSpec;
  state: 'running' | 'stopped';
  completedSteps: number;
  startedAt: number;
  stoppedAt?: number;
  stopReason?: RunStopReason;
  conditionValue?: unknown;
  conditionError?: string;
}

export interface RunScheduler {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface RunRenderBarrier {
  wait(task: RuntimeTaskSnapshot, payload: ActionEndPayload): void | Promise<void>;
}

export interface RunControllerOptions {
  scenario: Scenario;
  send(message: RendererToSimulatorMessage): void;
  scheduler?: RunScheduler;
  renderBarrier?: RunRenderBarrier;
  actionTimeoutMs?: number;
  onActionTimeout?: (task: RuntimeTaskSnapshot) => void;
  maxStepsPolicy?: number;
  idFactory?: () => string;
  onStateChange?: (status: RunStatus | null) => void;
  onRunStart?: (status: RunStatus) => void;
  onRunStop?: (status: RunStatus) => void;
}

const nativeScheduler: RunScheduler = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

const cloneStatus = (status: RunStatus): RunStatus => structuredClone(status);

function normalizeRunSpec(spec: RunSpec, maxStepsPolicy: number): RunSpec {
  if (!spec.actionId.trim()) {
    throw new Error('RunSpec.actionId must not be empty.');
  }
  if (!Number.isInteger(spec.maxSteps) || spec.maxSteps < 1) {
    throw new Error('RunSpec.maxSteps must be a positive integer.');
  }
  if (spec.maxSteps > maxStepsPolicy) {
    throw new Error(`RunSpec.maxSteps exceeds the configured policy limit (${maxStepsPolicy}).`);
  }
  if (spec.maxWallTimeMs !== undefined && (!Number.isFinite(spec.maxWallTimeMs) || spec.maxWallTimeMs <= 0)) {
    throw new Error('RunSpec.maxWallTimeMs must be a positive finite number when specified.');
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

  constructor(private readonly options: RunControllerOptions) {
    this.scheduler = options.scheduler ?? nativeScheduler;
    this.maxStepsPolicy = options.maxStepsPolicy ?? DEFAULT_RUN_MAX_STEPS;
    if (!Number.isInteger(this.maxStepsPolicy) || this.maxStepsPolicy < 1) {
      throw new Error('maxStepsPolicy must be a positive integer.');
    }
    this.idFactory = options.idFactory ?? (() => (
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `run-${Date.now()}-${Math.random().toString(36).slice(2)}`
    ));
    this.actionTimeoutMs = this.normalizeActionTimeout(options.actionTimeoutMs ?? 5_000);
    this.runtime = new PipelineRuntime({ now: () => this.scheduler.now(), idFactory: this.idFactory });
  }

  get status(): RunStatus | null {
    return this.activeRun === null ? null : cloneStatus(this.activeRun);
  }

  get isRunning(): boolean {
    return this.activeRun?.state === 'running';
  }

  setActionTimeoutMs(timeoutMs: number): void {
    this.actionTimeoutMs = this.normalizeActionTimeout(timeoutMs);
    const activeTask = this.runtime.peekActiveTaskRef();
    if (activeTask?.stage === 'dispatched') this.scheduleActionTimeout(activeTask);
  }

  requestStateSync(requestId?: string): void {
    this.runtime.requestStateSync(requestId);
  }

  recordStateSyncBoundary(phase: 'begin' | 'end', payload: StateSyncBoundaryPayload = {}): boolean {
    const accepted = this.runtime.recordStateSyncBoundary(phase, payload);
    if (accepted && phase === 'end') this.flushCommands();
    return accepted;
  }

  requestAction(actionId: string, continuous = false): string {
    if (!continuous) {
      this.finish('stopped');
      this.runtime.cancel();
    }
    const taskId = this.runtime.enqueue(actionId, { continuous });
    this.flushCommands();
    return taskId;
  }

  start(spec: RunSpec): RunStatus {
    this.stop('stopped');
    const normalized = normalizeRunSpec(spec, this.maxStepsPolicy);
    this.condition = normalized.stopWhen === undefined ? null : compileRunCondition(normalized.stopWhen);
    const status: RunStatus = {
      id: this.idFactory(),
      spec: normalized,
      state: 'running',
      completedSteps: 0,
      startedAt: this.scheduler.now(),
    };
    this.activeRun = status;
    this.options.onRunStart?.(cloneStatus(status));

    if (this.evaluateCondition()) {
      this.finish('condition');
      return this.status!;
    }

    if (normalized.maxWallTimeMs !== undefined) {
      this.deadlineHandle = this.scheduler.setTimeout(() => this.finish('wall-time'), normalized.maxWallTimeMs);
    }

    this.runtime.cancel();
    this.runtime.enqueue(normalized.actionId, { continuous: true });
    this.flushCommands();
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
  }

  observeActionEnd(payload: ActionEndPayload): boolean {
    const task = this.matchActiveTask(payload);
    if (!task) return false;

    this.clearActionTimeout(task.id);

    if (!this.runtime.completeTask(task.id, { continue: payload.continue, timings: payload.timings })) {
      return false;
    }
    this.runtime.markTaskApplied(task.id);

    const run = this.activeRun;
    if (run?.state === 'running' && task.key === run.spec.actionId) {
      run.completedSteps += 1;
      const conditionMatched = this.evaluateCondition();
      if (conditionMatched) {
        this.finish('condition');
      } else if (run.completedSteps >= run.spec.maxSteps) {
        this.finish('max-steps');
      } else if (payload.continue === false) {
        this.finish('simulator');
      } else {
        this.publish();
      }
    }

    if (payload.continue === false) {
      this.runtime.cancel(task.key);
    }

    if (this.options.renderBarrier) {
      void Promise.resolve(this.options.renderBarrier.wait(task, payload))
        .finally(() => this.markActionRendered(payload));
    }
    return true;
  }

  markActionRendered(payload: Pick<ActionEndPayload, 'id' | 'tick_id'>): boolean {
    const task = this.matchActiveTask(payload);
    if (!task) return false;
    const rendered = this.runtime.markTaskRendered(task.id);
    if (rendered) this.flushCommands();
    return rendered;
  }

  cancelContinuousActions(actionId?: string): void {
    this.runtime.cancel(actionId);
  }

  private evaluateCondition(): boolean {
    if (!this.activeRun || !this.condition) return false;
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
    this.runtime.cancel(run.spec.actionId);
    run.state = 'stopped';
    run.stopReason = reason;
    run.stoppedAt = this.scheduler.now();
    this.condition = null;
    this.publish();
    this.options.onRunStop?.(cloneStatus(run));
  }

  private matchActiveTask(payload: Pick<ActionEndPayload, 'id' | 'tick_id'>): RuntimeTaskSnapshot | null {
    const activeTask = this.runtime.peekActiveTaskRef();
    if (!activeTask) return null;
    if (payload.tick_id) return activeTask.id === payload.tick_id ? activeTask : null;
    return activeTask.key === payload.id ? activeTask : null;
  }

  private flushCommands(): void {
    const commands = this.runtime.consumeCommands();
    for (const command of commands) {
      if (command.type !== 'dispatch') continue;
      this.options.send(this.options.scenario.createActionStartMessage(
        command.task.key,
        command.task.continuous,
        command.task.id,
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
      this.runtime.completeTask(activeTask.id, { continue: false });
      this.runtime.markTaskApplied(activeTask.id);
      if (this.activeRun?.state === 'running' && this.activeRun.spec.actionId === activeTask.key) {
        this.finish('action-timeout');
      } else {
        this.runtime.cancel(activeTask.key);
      }
      this.runtime.markTaskRendered(activeTask.id);
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

  private publish(): void {
    this.options.onStateChange?.(this.status);
  }
}
