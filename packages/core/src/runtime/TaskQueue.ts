/**
 * runtime/TaskQueue.ts
 *
 *
 * Handles pure FIFO task scheduling, continuous-key deduplication, O(1) task
 * lookup, and the pending-dispatch command queue. Contains no sync-boundary
 * or metrics logic.
 */

import type { TickTimingBreakdown } from '@tensnap/protocol';

export type RuntimeTaskStage = 'queued' | 'dispatched' | 'completed' | 'applied';

export interface RuntimeTaskCompletion {
  should_continue?: boolean;
  timings?: TickTimingBreakdown;
}

export interface RuntimeTaskSnapshot {
  id: string;
  key: string;
  continuous: boolean;
  stage: RuntimeTaskStage;
  enqueuedAt: number;
  dispatchedAt: number | null;
  completedAt: number | null;
  appliedAt: number | null;
  renderedAt: number | null;
  continueRequested: boolean | null;
  timings?: TickTimingBreakdown;
}

export interface RuntimeDispatchCommand {
  type: 'dispatch';
  task: RuntimeTaskSnapshot;
}

export interface TaskQueueSnapshot {
  queueDepth: number;
  activeTask: RuntimeTaskSnapshot | null;
  queuedTasks: RuntimeTaskSnapshot[];
  continuousKeys: string[];
  pendingCommands: RuntimeDispatchCommand[];
}

type RuntimeTaskRecord = RuntimeTaskSnapshot;

const cloneTask = (task: RuntimeTaskRecord): RuntimeTaskSnapshot => ({
  ...task,
  timings: task.timings !== undefined ? { ...task.timings } : undefined,
});

const cloneCommand = (command: RuntimeDispatchCommand): RuntimeDispatchCommand => ({
  ...command,
  task: cloneTask(command.task),
});

export class TaskQueue {
  /**
   * FIFO queue of tasks waiting to be dispatched (stage === 'queued').
   */
  private readonly queue: RuntimeTaskRecord[] = [];

  /**
   * The single in-flight task (stage === 'dispatched' | 'completed' | 'applied').
   */
  private activeTask: RuntimeTaskRecord | null = null;

  /** O(1) task lookup by ID. */
  private readonly taskById = new Map<string, RuntimeTaskRecord>();

  /** O(1) deduplication of continuous tasks by key. */
  private readonly continuousTaskByKey = new Map<string, RuntimeTaskRecord>();

  private readonly pendingCommands: RuntimeDispatchCommand[] = [];
  private readonly continuousKeys = new Set<string>();

  constructor(
    private readonly now: () => number,
    private readonly idFactory: () => string,
  ) {}

  // #region Enqueue / Cancel

  enqueue(key: string, options: { continuous?: boolean } = {}): string {
    const continuous = options.continuous ?? false;

    if (continuous) {
      this.continuousKeys.add(key);
      const existing = this.continuousTaskByKey.get(key);
      if (existing !== undefined) {
        return existing.id;
      }
    }

    const task: RuntimeTaskRecord = {
      id: this.idFactory(),
      key,
      continuous,
      stage: 'queued',
      enqueuedAt: this.now(),
      dispatchedAt: null,
      completedAt: null,
      appliedAt: null,
      renderedAt: null,
      continueRequested: null,
    };

    this.taskById.set(task.id, task);
    if (continuous) {
      this.continuousTaskByKey.set(key, task);
    }
    this.queue.push(task);
    return task.id;
  }

  /** Remove queued work and return exactly the task IDs that were removed. */
  cancel(key?: string): string[] {
    const cancelledTaskIds: string[] = [];
    if (key !== undefined) {
      this.continuousKeys.delete(key);
      this.continuousTaskByKey.delete(key);
      let writeIndex = 0;
      for (const task of this.queue) {
        if (task.key === key) {
          this.taskById.delete(task.id);
          cancelledTaskIds.push(task.id);
        } else {
          this.queue[writeIndex++] = task;
        }
      }
      this.queue.length = writeIndex;
      return cancelledTaskIds;
    }

    this.continuousKeys.clear();
    this.continuousTaskByKey.clear();
    for (let i = 0; i < this.queue.length; i++) {
      this.taskById.delete(this.queue[i].id);
      cancelledTaskIds.push(this.queue[i].id);
    }
    this.queue.length = 0;
    return cancelledTaskIds;
  }

  reset(): void {
    this.queue.length = 0;
    this.activeTask = null;
    this.taskById.clear();
    this.continuousTaskByKey.clear();
    this.pendingCommands.length = 0;
    this.continuousKeys.clear();
  }

  // #endregion

  // #region Task Lifecycle

  completeTask(taskId: string, completion: RuntimeTaskCompletion = {}): boolean {
    const task = this.taskById.get(taskId);
    if (task === undefined || task.stage !== 'dispatched') {
      return false;
    }

    task.stage = 'completed';
    task.completedAt = this.now();
    task.continueRequested = completion.should_continue ?? null;
    if (completion.timings !== undefined) {
      task.timings = { ...completion.timings };
    }
    return true;
  }

  markTaskApplied(taskId: string): boolean {
    const task = this.taskById.get(taskId);
    if (
      task === undefined ||
      (task.stage !== 'completed' && task.stage !== 'applied')
    ) {
      return false;
    }

    task.stage = 'applied';
    task.appliedAt = task.appliedAt ?? this.now();
    return true;
  }

  /**
   * Marks a task as rendered and, if the task is continuous and re-enqueue is
   * requested, re-enqueues it. Returns `true` if the task was found and
   * advanced; `false` otherwise.
   *
   * @param onReEnqueue - Callback invoked (with the key) when a continuous task
   *   should be re-enqueued. The caller (PipelineRuntime) is responsible for
   *   calling `enqueue` so that `maybeDispatchNext` can be triggered correctly.
   */
  markTaskRendered(
    taskId: string,
    onReEnqueue: (key: string) => void,
    onAdvanceNext: () => void,
  ): boolean {
    const task = this.taskById.get(taskId);
    if (
      task === undefined ||
      (task.stage !== 'completed' && task.stage !== 'applied')
    ) {
      return false;
    }

    task.renderedAt = this.now();

    const shouldContinue =
      task.continuous &&
      this.continuousKeys.has(task.key) &&
      task.continueRequested !== false;
    const nextKey = task.key;

    this.taskById.delete(taskId);
    if (task.continuous) {
      this.continuousTaskByKey.delete(task.key);
    }
    this.activeTask = null;

    if (shouldContinue) {
      onReEnqueue(nextKey);
    } else {
      onAdvanceNext();
    }
    return true;
  }

  // #endregion

  // #region Dispatch Commands

  /**
   * Advance the next queued task to 'dispatched' and push a dispatch command.
   * Called by PipelineRuntime when sync is idle and no active task exists.
   */
  maybeDispatchNext(): void {
    if (this.activeTask !== null || this.queue.length === 0) {
      return;
    }

    const nextTask = this.queue.shift()!;
    nextTask.stage = 'dispatched';
    nextTask.dispatchedAt = this.now();
    this.activeTask = nextTask;
    this.pendingCommands.push({
      type: 'dispatch',
      task: cloneTask(nextTask),
    });
  }

  consumeCommands(): RuntimeDispatchCommand[] {
    // Dispatch commands already own task snapshots, so splicing them out does
    // not expose the active mutable task. Avoid a second clone on every tick.
    return this.pendingCommands.splice(0);
  }

  takeNextDispatchTask(): RuntimeTaskSnapshot | null {
    const command = this.pendingCommands.shift();
    if (command === undefined || command.type !== 'dispatch') {
      return null;
    }
    return command.task;
  }

  /**
   * Cancel a 'dispatched' active task whose action_invoke has NOT been sent.
   */
  cancelPendingDispatch(taskId: string): boolean {
    const task = this.taskById.get(taskId);
    if (
      task === undefined ||
      task.stage !== 'dispatched' ||
      this.activeTask?.id !== taskId
    ) {
      return false;
    }

    this.taskById.delete(taskId);
    const commandIndex = this.pendingCommands.findIndex((command) => command.task.id === taskId);
    if (commandIndex !== -1) this.pendingCommands.splice(commandIndex, 1);
    if (task.continuous) {
      this.continuousTaskByKey.delete(task.key);
      this.continuousKeys.delete(task.key);
    }
    this.activeTask = null;
    return true;
  }

  // #endregion

  // #region Query

  hasContinuousKey(key: string): boolean {
    return this.continuousKeys.has(key);
  }

  getContinuousKeys(): string[] {
    return [...this.continuousKeys];
  }

  getContinuousKeyCount(): number {
    return this.continuousKeys.size;
  }

  get hasActiveTask(): boolean {
    return this.activeTask !== null;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  peekActiveTaskRef(): RuntimeTaskSnapshot | null {
    return this.activeTask;
  }

  peekActiveTask(): RuntimeTaskSnapshot | null {
    return this.activeTask !== null ? cloneTask(this.activeTask) : null;
  }

  getSnapshot(): TaskQueueSnapshot {
    return {
      queueDepth: this.queue.length,
      activeTask: this.activeTask !== null ? cloneTask(this.activeTask) : null,
      queuedTasks: this.queue.map(cloneTask),
      continuousKeys: [...this.continuousKeys],
      pendingCommands: this.pendingCommands.map(cloneCommand),
    };
  }

  // #endregion
}
