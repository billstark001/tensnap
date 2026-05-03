import type { StateSyncBoundaryPayload, TickTimingBreakdown } from '../protocol';

export type RuntimeSyncPhase = 'idle' | 'requested' | 'receiving';
export type RuntimeTaskStage = 'queued' | 'dispatched' | 'completed' | 'applied';
export type RuntimePhase =
  | 'idle'
  | 'syncing'
  | 'queued'
  | 'awaiting-completion'
  | 'awaiting-apply'
  | 'awaiting-render';

export interface RuntimeTaskCompletion {
  continue?: boolean;
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

export type RuntimeCommand = RuntimeDispatchCommand;

export interface RuntimeSyncSnapshot {
  requestId: string | null;
  phase: RuntimeSyncPhase;
}

export interface RuntimeSnapshot {
  phase: RuntimePhase;
  sync: RuntimeSyncSnapshot;
  queueDepth: number;
  activeTask: RuntimeTaskSnapshot | null;
  queuedTasks: RuntimeTaskSnapshot[];
  continuousKeys: string[];
  pendingCommands: RuntimeCommand[];
}

export interface PipelineRuntimeOptions {
  now?: () => number;
  idFactory?: () => string;
}

type RuntimeTaskRecord = RuntimeTaskSnapshot;

const createIdleSyncState = (): RuntimeSyncSnapshot => ({
  requestId: null,
  phase: 'idle',
});

const cloneTask = (task: RuntimeTaskRecord): RuntimeTaskSnapshot => ({
  ...task,
  timings: task.timings !== undefined ? { ...task.timings } : undefined,
});

const cloneCommand = (command: RuntimeCommand): RuntimeCommand => ({
  ...command,
  task: cloneTask(command.task),
});

export class PipelineRuntime {
  /**
   * FIFO queue of tasks waiting to be dispatched (stage === 'queued').
   * Kept separate from the active task so queue depth and head access are O(1).
   */
  private readonly queue: RuntimeTaskRecord[] = [];

  /**
   * The single in-flight task (stage === 'dispatched' | 'completed' | 'applied').
   * Cached directly to avoid repeated O(n) scans for the active-task check.
   */
  private activeTask: RuntimeTaskRecord | null = null;

  /**
   * O(1) task lookup by ID, covering both queued and active tasks.
   * Replaces all tasks.find(t => t.id === id) calls.
   */
  private readonly taskById = new Map<string, RuntimeTaskRecord>();

  /**
   * O(1) deduplication of continuous tasks by key.
   * Replaces the O(n) findOpenTaskByKey scan in enqueue().
   * Invariant: at most one live task (queued or active) per continuous key.
   */
  private readonly continuousTaskByKey = new Map<string, RuntimeTaskRecord>();

  private readonly pendingCommands: RuntimeCommand[] = [];
  private readonly continuousKeys = new Set<string>();
  private sync: RuntimeSyncSnapshot = createIdleSyncState();
  private readonly now: () => number;
  private readonly idFactory: () => string;

  constructor(options: PipelineRuntimeOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.idFactory =
      options.idFactory ??
      (() => {
        if (
          typeof crypto !== 'undefined' &&
          typeof crypto.randomUUID === 'function'
        ) {
          return crypto.randomUUID();
        }
        return `runtime-${Math.random().toString(36).slice(2)}`;
      });
  }

  requestStateSync(requestId?: string): void {
    this.sync = {
      requestId: requestId ?? null,
      phase: 'requested',
    };
  }

  recordStateSyncBoundary(
    phase: 'begin' | 'end',
    payload: StateSyncBoundaryPayload = {},
  ): boolean {
    if (!this.matchesSyncRequest(payload.request_id)) {
      return false;
    }

    if (phase === 'begin') {
      this.sync = { ...this.sync, phase: 'receiving' };
      return true;
    }

    this.sync = createIdleSyncState();
    this.maybeDispatchNext();
    return true;
  }

  enqueue(key: string, options: { continuous?: boolean } = {}): string {
    const continuous = options.continuous ?? false;

    if (continuous) {
      this.continuousKeys.add(key);
      // O(1) — replaces O(n) findOpenTaskByKey scan
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
    this.maybeDispatchNext();
    return task.id;
  }

  cancel(key?: string): void {
    if (key !== undefined) {
      this.continuousKeys.delete(key);
      this.continuousTaskByKey.delete(key);
      for (let i = this.queue.length - 1; i >= 0; i--) {
        if (this.queue[i].key === key) {
          this.taskById.delete(this.queue[i].id);
          this.queue.splice(i, 1);
        }
      }
      return;
    }

    this.continuousKeys.clear();
    this.continuousTaskByKey.clear();
    for (let i = 0; i < this.queue.length; i++) {
      this.taskById.delete(this.queue[i].id);
    }
    this.queue.length = 0;
  }

  reset(): void {
    this.queue.length = 0;
    this.activeTask = null;
    this.taskById.clear();
    this.continuousTaskByKey.clear();
    this.pendingCommands.length = 0;
    this.continuousKeys.clear();
    this.sync = createIdleSyncState();
  }

  completeTask(taskId: string, completion: RuntimeTaskCompletion = {}): boolean {
    // O(1) — replaces O(n) tasks.find()
    const task = this.taskById.get(taskId);
    if (task === undefined || task.stage !== 'dispatched') {
      return false;
    }

    task.stage = 'completed';
    task.completedAt = this.now();
    task.continueRequested = completion.continue ?? null;
    // Only write when provided; avoids a redundant self-assignment
    if (completion.timings !== undefined) {
      task.timings = { ...completion.timings };
    }
    return true;
  }

  markTaskApplied(taskId: string): boolean {
    // O(1) — replaces O(n) tasks.find()
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

  markTaskRendered(taskId: string): boolean {
    // O(1) — replaces O(n) tasks.find()
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

    // O(1) removal — replaces O(n) tasks.splice(findIndex(...))
    this.taskById.delete(taskId);
    if (task.continuous) {
      this.continuousTaskByKey.delete(task.key);
    }
    this.activeTask = null;

    if (shouldContinue) {
      this.enqueue(nextKey, { continuous: true });
    } else {
      this.maybeDispatchNext();
    }
    return true;
  }

  consumeCommands(): RuntimeCommand[] {
    const commands = this.pendingCommands.map(cloneCommand);
    this.pendingCommands.length = 0;
    return commands;
  }

  takeNextDispatchTask(): RuntimeTaskSnapshot | null {
    const command = this.pendingCommands.shift();
    if (command === undefined || command.type !== 'dispatch') {
      return null;
    }
    return command.task;
  }

  getSnapshot(): RuntimeSnapshot {
    return {
      phase: this.getPhase(),
      sync: { ...this.sync },
      // O(1) — replaces O(n) tasks.filter(queued).length
      queueDepth: this.queue.length,
      // O(1) — replaces O(n) tasks.find(non-queued)
      activeTask: this.activeTask !== null ? cloneTask(this.activeTask) : null,
      queuedTasks: this.queue.map(cloneTask),
      continuousKeys: [...this.continuousKeys],
      pendingCommands: this.pendingCommands.map(cloneCommand),
    };
  }
  
  hasContinuousKey(key: string): boolean {
    return this.continuousKeys.has(key);
  }

  getContinuousKeys(): string[] {
    return [...this.continuousKeys];
  }

  getContinuousKeyCount(): number {
    return this.continuousKeys.size;
  }

  peekActiveTaskRef(): RuntimeTaskSnapshot | null {
    return this.activeTask;
  }

  peekActiveTask(): RuntimeTaskSnapshot | null {
    return this.activeTask !== null ? cloneTask(this.activeTask) : null;
  }

  private matchesSyncRequest(requestId?: string): boolean {
    if (this.sync.requestId === null) {
      return false;
    }
    return requestId === undefined || requestId === this.sync.requestId;
  }

  private maybeDispatchNext(): void {
    // All three checks are now O(1)
    if (
      this.sync.phase !== 'idle' ||
      this.activeTask !== null ||
      this.queue.length === 0
    ) {
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

  private getPhase(): RuntimePhase {
    // Fully O(1) — previously called getActiveTask() twice (two O(n) scans)
    if (this.sync.phase !== 'idle') {
      return 'syncing';
    }

    if (this.activeTask !== null) {
      const { stage } = this.activeTask;
      if (stage === 'dispatched') return 'awaiting-completion';
      if (stage === 'completed') return 'awaiting-apply';
      return 'awaiting-render';
    }

    if (this.queue.length > 0) {
      return 'queued';
    }

    return 'idle';
  }
}