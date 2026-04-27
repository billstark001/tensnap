import { EventEmitter } from 'node:events';
import type {
  ActionEndPayload,
  ProtocolEncoding,
  ScreenshotRequestPayload,
  SimulatorToRendererMessage,
} from '@tensnap/core/protocol';
import { AgentSession } from '../session/AgentSession';
import { getReservedSceneActionId, type SceneReservedAction } from '../session/reserved-actions';
import type {
  ActionRunOptions,
  ChartSeriesSnapshot,
  ConnectOptions,
  ExperimentRunRequest,
  ExperimentRunResult,
  ExperimentWaitRequest,
  ExperimentWaitResult,
  SceneRenderOptions,
  SceneAssetSummary,
  SceneSnapshotInspection,
  RenderSettings,
  RenderTriggerMode,
  RuntimeControlFile,
  RuntimeEvent,
  RuntimeLogEntry,
  RuntimePhase,
  RuntimeStatus,
  SceneSummary,
  WaitComparisonOperator,
  WaitForChartOptions,
  WaitForChartResult,
  WaitForActionEndOptions,
  WaitForActionEndResult,
  WaitForMetadataOptions,
  WaitForMetadataResult,
  WaitForTimeOptions,
  WaitForTimeResult,
} from '../types';
import {
  appendRuntimeLog,
  ensureRuntimeContext,
  type RuntimeContextPaths,
  writeRuntimeControl,
  writeSceneSnapshot,
} from './context';
import type { RenderArtifact, ScenePainter } from './painter';
import type { RenderRequest } from './painter';

export interface AgentRuntimeOptions {
  host?: string;
  controlPort?: number | null;
  encoding?: ProtocolEncoding;
  render?: Partial<RenderSettings>;
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function compareValues(actual: unknown, comparison: WaitComparisonOperator, expected: unknown): boolean {
  if (comparison === 'eq') {
    return valuesEqual(actual, expected);
  }

  if (comparison === 'neq') {
    return !valuesEqual(actual, expected);
  }

  if (typeof actual !== typeof expected) {
    return false;
  }

  if (typeof actual !== 'number' && typeof actual !== 'string') {
    return false;
  }

  switch (comparison) {
    case 'gt':
      return actual > (expected as number | string);
    case 'gte':
      return actual >= (expected as number | string);
    case 'lt':
      return actual < (expected as number | string);
    case 'lte':
      return actual <= (expected as number | string);
    default:
      return false;
  }
}

function getValueAtPath(source: unknown, path: string): unknown {
  if (!path.trim()) {
    return source;
  }

  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === undefined || current === null) {
      return undefined;
    }

    if (Array.isArray(current)) {
      const index = Number(segment);
      return Number.isInteger(index) ? current[index] : undefined;
    }

    if (typeof current === 'object') {
      return (current as Record<string, unknown>)[segment];
    }

    return undefined;
  }, source);
}

export class AgentRuntime extends EventEmitter {
  private readonly session = new AgentSession();
  private readonly painters = new Map<string, ScenePainter>();
  private readonly control: RuntimeControlFile;
  private completedStateSyncCount = 0;

  constructor(
    readonly context: RuntimeContextPaths,
    options: AgentRuntimeOptions = {},
  ) {
    super();

    const now = new Date().toISOString();
    this.control = {
      version: 1,
      contextName: context.contextName,
      contextDir: context.contextDir,
      createdAt: now,
      updatedAt: now,
      host: options.host ?? '127.0.0.1',
      controlPort: options.controlPort ?? null,
      pid: process.pid,
      phase: 'idle',
      encoding: options.encoding ?? 'msgpack',
      render: {
        trigger: options.render?.trigger ?? 'manual',
      },
      painters: [],
    };

    this.bindSession();
  }

  async initialize(): Promise<void> {
    await ensureRuntimeContext(this.context);
    await this.persistStatus();
    await this.log('info', 'runtime', 'Runtime initialized.', { context: this.context.contextName });
  }

  async connect(options: ConnectOptions): Promise<RuntimeStatus> {
    this.setPhase('connecting');
    this.control.simulatorUrl = options.simulatorUrl;
    this.control.encoding = options.encoding ?? this.control.encoding;
    this.completedStateSyncCount = 0;
    await this.persistStatus();

    try {
      await this.session.connect({
        url: options.simulatorUrl,
        encoding: this.control.encoding,
      });
      await this.log('info', 'runtime', 'Connected to simulator.', {
        simulatorUrl: options.simulatorUrl,
        encoding: this.control.encoding,
      });
      return this.getStatus();
    } catch (error) {
      this.control.lastError = error instanceof Error ? error.message : String(error);
      this.setPhase('error');
      await this.log('error', 'runtime', 'Failed to connect to simulator.', { error: this.control.lastError });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.session.isConnected) {
      this.setPhase('idle');
      return;
    }

    this.setPhase('stopping');
    await this.session.disconnect();
    this.setPhase('idle');
    await this.log('info', 'runtime', 'Disconnected from simulator.');
  }

  async stop(): Promise<void> {
    this.setPhase('stopping');
    await this.disconnect();
    this.control.pid = null;
    this.control.controlPort = null;
    this.setPhase('stopped');
    await this.persistStatus();
  }

  getStatus(): RuntimeStatus {
    return {
      ...this.control,
      isConnected: this.session.isConnected,
    };
  }

  getRenderSettings(): RenderSettings {
    return structuredClone(this.control.render);
  }

  async setRenderTrigger(trigger: RenderTriggerMode): Promise<RuntimeStatus> {
    this.control.render = { trigger };
    await this.persistStatus();
    this.emitRuntimeEvent('render.trigger.updated', { trigger });
    await this.log('info', 'render', 'Render trigger updated.', { trigger });
    return this.getStatus();
  }

  registerPainter(painter: ScenePainter): void {
    this.painters.set(painter.id, painter);
    this.control.painters = [...this.painters.keys()];
    void this.persistStatus();
    this.emitRuntimeEvent('render.painter.registered', { painterId: painter.id });
  }

  unregisterPainter(id: string): void {
    if (!this.painters.delete(id)) {
      return;
    }

    this.control.painters = [...this.painters.keys()];
    void this.persistStatus();
    this.emitRuntimeEvent('render.painter.unregistered', { painterId: id });
  }

  getPainterIds(): string[] {
    return [...this.painters.keys()];
  }

  inspectScene(): SceneSummary {
    return this.session.getSceneSummary();
  }

  inspectSnapshot(): SceneSnapshotInspection {
    return {
      snapshot: this.session.getSnapshot(),
      charts: this.session.listChartSeries(),
      assets: this.session.listAssets(),
    };
  }

  listChartSeries(): ChartSeriesSnapshot[] {
    return this.session.listChartSeries();
  }

  getChartSeries(id: string): ChartSeriesSnapshot | null {
    return this.session.getChartSeries(id);
  }

  listAssets(): SceneAssetSummary[] {
    return this.session.listAssets();
  }

  listParameters() {
    return this.session.getParameters();
  }

  listActions() {
    return this.session.getActions();
  }

  async syncScene(): Promise<void> {
    const targetSyncCount = this.completedStateSyncCount + 1;
    this.assertConnected();
    this.setPhase('syncing');
    this.session.requestStateSync();
    await this.log('info', 'scene', 'State sync requested.');
    this.emitRuntimeEvent('scene.sync.requested', {});
    await this.waitForStateSync(targetSyncCount);
  }

  async waitUntilReady(timeoutMs?: number): Promise<RuntimeStatus> {
    return await this.waitForStateSync(1, timeoutMs);
  }

  async setParameter(id: string, value: unknown): Promise<void> {
    this.assertConnected();
    this.session.setParameter(id, value);
    await this.log('info', 'param', 'Parameter change requested.', { id, value });
    this.emitRuntimeEvent('param.change.requested', { id, value });
  }

  async runAction(id: string, options: ActionRunOptions = {}): Promise<void> {
    this.assertConnected();
    if (!options.continuous) {
      this.session.cancelContinuousActions();
    }
    this.session.runAction(id, options.continuous);
    await this.log('info', 'action', 'Action requested.', {
      id,
      continuous: options.continuous ?? false,
    });
    this.emitRuntimeEvent('action.start.requested', {
      id,
      continuous: options.continuous ?? false,
    });
  }

  async runReservedAction(alias: SceneReservedAction, options: ActionRunOptions = {}): Promise<void> {
    await this.runAction(getReservedSceneActionId(alias), options);
  }

  async waitForActionEnd(options: WaitForActionEndOptions = {}): Promise<WaitForActionEndResult> {
    this.assertConnected();

    return await new Promise<WaitForActionEndResult>((resolve, reject) => {
      const onActionEnd = (payload: ActionEndPayload): void => {
        if (options.id && payload.id !== options.id) {
          return;
        }
        cleanup();
        resolve(structuredClone(payload));
      };

      const onClose = (): void => {
        cleanup();
        reject(new Error('Runtime disconnected while waiting for action_end.'));
      };

      const onError = (error: unknown): void => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      const timeoutId = typeof options.timeoutMs === 'number'
        ? setTimeout(() => {
            cleanup();
            reject(
              new Error(
                options.id
                  ? `Timed out waiting for action_end '${options.id}'.`
                  : 'Timed out waiting for action_end.',
              ),
            );
          }, options.timeoutMs)
        : null;

      const cleanup = (): void => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        this.session.off('action-end', onActionEnd);
        this.session.off('close', onClose);
        this.session.off('error', onError);
      };

      this.session.on('action-end', onActionEnd);
      this.session.on('close', onClose);
      this.session.on('error', onError);
    });
  }

  async waitForTime(options: WaitForTimeOptions): Promise<WaitForTimeResult> {
    const comparison = options.comparison ?? 'gte';
    return await this.waitForStateCondition(
      () => {
        const actualTime = this.session.scenario.time;
        if (typeof actualTime !== 'number') {
          return undefined;
        }
        if (!compareValues(actualTime, comparison, options.time)) {
          return undefined;
        }
        return {
          kind: 'time' as const,
          comparison,
          expectedTime: options.time,
          actualTime,
        };
      },
      options.timeoutMs,
      `time ${comparison} ${options.time}`,
    );
  }

  async waitForChart(options: WaitForChartOptions): Promise<WaitForChartResult> {
    const comparison = options.comparison ?? 'gte';
    return await this.waitForStateCondition(
      () => {
        const actualValue = typeof options.atTime === 'number'
          ? this.session.scenario.charts.getValueAt(options.id, options.atTime)
          : this.session.getChartSeries(options.id)?.points.at(-1)?.[options.id];

        if (typeof actualValue !== 'number') {
          return undefined;
        }
        if (!compareValues(actualValue, comparison, options.value)) {
          return undefined;
        }
        return {
          kind: 'chart' as const,
          id: options.id,
          comparison,
          expectedValue: options.value,
          actualValue,
          atTime: options.atTime,
        };
      },
      options.timeoutMs,
      `chart ${options.id} ${comparison} ${options.value}`,
    );
  }

  async waitForMetadata(options: WaitForMetadataOptions): Promise<WaitForMetadataResult> {
    const comparison = options.comparison ?? 'eq';
    return await this.waitForStateCondition(
      () => {
        const actualValue = getValueAtPath(this.session.getSnapshot().metadata, options.path);
        if (comparison === 'exists') {
          if (actualValue === undefined) {
            return undefined;
          }
          return {
            kind: 'metadata' as const,
            path: options.path,
            comparison,
            actualValue: cloneValue(actualValue),
          };
        }

        if (!compareValues(actualValue, comparison, options.value)) {
          return undefined;
        }
        return {
          kind: 'metadata' as const,
          path: options.path,
          comparison,
          expectedValue: cloneValue(options.value),
          actualValue: cloneValue(actualValue),
        };
      },
      options.timeoutMs,
      `metadata ${options.path} ${comparison}`,
    );
  }

  async runExperiment(request: ExperimentRunRequest): Promise<ExperimentRunResult> {
    this.assertConnected();

    const startedAt = new Date().toISOString();
    const waits: ExperimentWaitResult[] = [];
    const parametersApplied: Array<{ id: string; value: unknown }> = [];
    const collect = {
      scene: true,
      snapshot: true,
      ...(request.collect ?? {}),
    };

    const resetConfig =
      request.reset === false
        ? null
        : request.reset === true || request.reset === undefined
          ? { enabled: true, actionId: getReservedSceneActionId('reset') }
          : {
              enabled: request.reset.enabled !== false,
              actionId: request.reset.actionId ?? getReservedSceneActionId('reset'),
              continuous: request.reset.continuous,
              timeoutMs: request.reset.timeoutMs,
            };

    if (resetConfig?.enabled) {
      const resetWait = this.waitForActionEnd({
        id: resetConfig.actionId,
        timeoutMs: resetConfig.timeoutMs,
      });
      await this.runAction(resetConfig.actionId, { continuous: resetConfig.continuous });
      waits.push({ kind: 'action-end', payload: await resetWait });
    }

    for (const [id, value] of Object.entries(request.parameters ?? {})) {
      await this.setParameter(id, value);
      parametersApplied.push({ id, value: cloneValue(value) });
    }

    if (request.action) {
      const actionWait = request.action.waitForEnd === false
        ? null
        : this.waitForActionEnd({
            id: request.action.id,
            timeoutMs: request.action.timeoutMs,
          });
      await this.runAction(request.action.id, { continuous: request.action.continuous });
      if (actionWait) {
        waits.push({ kind: 'action-end', payload: await actionWait });
      }
    }

    for (const waitRequest of request.waits ?? []) {
      waits.push(await this.executeExperimentWait(waitRequest));
    }

    const renderArtifacts = request.render
      ? await this.requestRender(
          request.render,
          request.render.reason ?? request.label ?? 'experiment',
        )
      : undefined;

    const result: ExperimentRunResult = {
      label: request.label,
      startedAt,
      finishedAt: new Date().toISOString(),
      parametersApplied,
      waits,
    };

    if (collect.scene) {
      result.scene = this.inspectScene();
    }
    if (collect.snapshot) {
      result.snapshot = this.inspectSnapshot();
    }
    if (renderArtifacts?.length) {
      result.renderArtifacts = renderArtifacts;
    }

    await this.log('info', 'experiment', 'Experiment run completed.', {
      label: request.label,
      parametersApplied: parametersApplied.map((entry) => entry.id),
      waitKinds: waits.map((entry) => entry.kind),
      renderArtifactCount: renderArtifacts?.length ?? 0,
    });
    this.emitRuntimeEvent('experiment.completed', {
      label: request.label,
      waitCount: waits.length,
      renderArtifactCount: renderArtifacts?.length ?? 0,
    });

    return result;
  }

  async requestRender(options: SceneRenderOptions = {}, reason = 'manual'): Promise<RenderArtifact[]> {
    const request = this.createRenderRequest(options, reason, 'explicit');
    const artifacts = await this.runPainters(request);
    await writeSceneSnapshot(this.context, request.snapshot);
    await this.log('info', 'render', 'Render requested.', {
      reason,
      trigger: 'explicit',
      painterCount: this.painters.size,
      artifactCount: artifacts.length,
      envId: options.envId,
      outputPath: options.outputPath,
    });
    this.emitRuntimeEvent('render.requested', {
      reason,
      trigger: 'explicit',
      painterCount: this.painters.size,
      artifactCount: artifacts.length,
      envId: options.envId,
      outputPath: options.outputPath,
    });
    return artifacts;
  }

  private async runPainters(request: RenderRequest): Promise<RenderArtifact[]> {
    const artifacts: RenderArtifact[] = [];
    for (const painter of this.painters.values()) {
      try {
        const result = await painter.render(request);
        if (result?.length) {
          artifacts.push(...result);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.log('error', 'render', 'Painter render failed.', { painterId: painter.id, error: message });
        this.emitRuntimeEvent('render.failed', { painterId: painter.id, error: message });
      }
    }

    return artifacts;
  }

  private createRenderRequest(
    options: SceneRenderOptions,
    reason: string,
    trigger: RenderTriggerMode | 'explicit',
  ): RenderRequest {
    return {
      at: new Date().toISOString(),
      reason,
      trigger,
      snapshot: this.session.getSnapshot(),
      options,
      assets: this.session.getAssetSources(),
    };
  }

  async setControlAddress(host: string, controlPort: number): Promise<void> {
    this.control.host = host;
    this.control.controlPort = controlPort;
    await this.persistStatus();
  }

  private bindSession(): void {
    this.session.on('open', () => {
      this.setPhase('open');
      this.emitRuntimeEvent('transport.open', { simulatorUrl: this.control.simulatorUrl });
    });
    this.session.on('close', () => {
      this.completedStateSyncCount = 0;
      if (this.control.phase !== 'stopped') {
        this.setPhase('idle');
      }
      this.emitRuntimeEvent('transport.close', { simulatorUrl: this.control.simulatorUrl });
    });
    this.session.on('error', (error) => {
      const message = error instanceof Error ? error.message : String(error);
      this.control.lastError = message;
      this.setPhase('error');
      void this.log('error', 'transport', 'Transport error.', { error: message });
      this.emitRuntimeEvent('transport.error', { error: message });
    });
    this.session.on('message', (message) => {
      void this.handleProtocolMessage(message as SimulatorToRendererMessage);
    });
    this.session.on('action-end', (payload) => {
      void this.handleActionEnd(payload as ActionEndPayload);
    });
    this.session.on('screenshot-request', (payload) => {
      void this.handleScreenshotRequest(payload as ScreenshotRequestPayload);
    });
  }

  private async handleProtocolMessage(message: SimulatorToRendererMessage): Promise<void> {
    this.emitRuntimeEvent('protocol.message', { type: message.type });

    if (message.type === 'state_sync_begin') {
      this.setPhase('syncing');
      this.emitRuntimeEvent('scene.sync.begin', message.payload);
      return;
    }

    if (message.type === 'state_sync_end') {
      this.completedStateSyncCount += 1;
      this.setPhase('ready');
      await writeSceneSnapshot(this.context, this.session.getSnapshot());
      this.emitRuntimeEvent('scene.sync.end', {
        completedCount: this.completedStateSyncCount,
        payload: message.payload,
      });
      return;
    }

    if (message.type === 'metadata_update') {
      await writeSceneSnapshot(this.context, this.session.getSnapshot());
    }
  }

  private async handleActionEnd(payload: ActionEndPayload): Promise<void> {
    try {
      await writeSceneSnapshot(this.context, this.session.getSnapshot());
      await this.log('info', 'action', 'Action completed.', payload);
      this.emitRuntimeEvent('action.end', payload);

      if (this.control.render.trigger === 'action-end') {
        const request = this.createRenderRequest({}, `action-end:${payload.id}`, 'action-end');
        const artifacts = await this.runPainters(request);

        await this.log('info', 'render', 'Auto render executed after action_end.', {
          actionId: payload.id,
          artifactCount: artifacts.length,
        });
        this.emitRuntimeEvent('render.requested', {
          reason: `action-end:${payload.id}`,
          trigger: 'action-end',
          painterCount: this.painters.size,
          artifactCount: artifacts.length,
        });
      }
    } finally {
      this.session.markActionRendered(payload);
    }
  }

  private async handleScreenshotRequest(payload: ScreenshotRequestPayload): Promise<void> {
    if (payload.chart_id) {
      this.session.sendScreenshotResponse({
        request_id: payload.request_id,
        error: 'Chart screenshots are not implemented in @tensnap/agent yet.',
      });
      return;
    }

    try {
      const artifacts = await this.requestRender(
        {
          envId: payload.env_id,
          format: payload.format ?? 'png',
          quality: payload.quality,
          includeData: true,
          persist: false,
        },
        `screenshot-request:${payload.request_id}`,
      );

      const artifact = artifacts.find((candidate) => candidate.kind === 'environment' && candidate.data?.length);
      if (!artifact?.data?.length) {
        this.session.sendScreenshotResponse({
          request_id: payload.request_id,
          error: 'No environment render artifact was produced for screenshot_request.',
        });
        return;
      }

      this.session.sendScreenshotResponse({
        request_id: payload.request_id,
        data: new Uint8Array(artifact.data),
        mime: artifact.mime,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.session.sendScreenshotResponse({
        request_id: payload.request_id,
        error: message,
      });
    }
  }

  private assertConnected(): void {
    if (!this.session.isConnected) {
      throw new Error('Runtime is not connected to a simulator.');
    }
  }

  private async executeExperimentWait(request: ExperimentWaitRequest): Promise<ExperimentWaitResult> {
    switch (request.kind) {
      case 'action-end':
        return {
          kind: 'action-end',
          payload: await this.waitForActionEnd(request),
        };
      case 'time':
        return await this.waitForTime(request);
      case 'chart':
        return await this.waitForChart(request);
      case 'metadata':
        return await this.waitForMetadata(request);
      default:
        throw new Error(`Unsupported wait kind: ${(request as { kind?: string }).kind ?? 'unknown'}`);
    }
  }

  private async waitForStateCondition<T>(
    evaluate: () => T | undefined,
    timeoutMs: number | undefined,
    description: string,
  ): Promise<T> {
    this.assertConnected();

    const immediate = evaluate();
    if (immediate !== undefined) {
      return cloneValue(immediate);
    }

    return await new Promise<T>((resolve, reject) => {
      const onMessage = (): void => {
        const matched = evaluate();
        if (matched === undefined) {
          return;
        }
        cleanup();
        resolve(cloneValue(matched));
      };

      const onClose = (): void => {
        cleanup();
        reject(new Error(`Runtime disconnected while waiting for ${description}.`));
      };

      const onError = (error: unknown): void => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      const timeoutId = typeof timeoutMs === 'number'
        ? setTimeout(() => {
            cleanup();
            reject(new Error(`Timed out waiting for ${description}.`));
          }, timeoutMs)
        : null;

      const cleanup = (): void => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        this.session.off('message', onMessage);
        this.session.off('close', onClose);
        this.session.off('error', onError);
      };

      this.session.on('message', onMessage);
      this.session.on('close', onClose);
      this.session.on('error', onError);
    });
  }

  private async waitForStateSync(
    minimumCompletedCount: number,
    timeoutMs?: number,
  ): Promise<RuntimeStatus> {
    const evaluate = (): RuntimeStatus | undefined => {
      if (
        this.session.isConnected
        && this.control.phase === 'ready'
        && this.completedStateSyncCount >= minimumCompletedCount
      ) {
        return this.getStatus();
      }
      return undefined;
    };

    const immediate = evaluate();
    if (immediate) {
      return immediate;
    }

    return await new Promise<RuntimeStatus>((resolve, reject) => {
      const onMessage = (): void => {
        const matched = evaluate();
        if (!matched) {
          return;
        }
        cleanup();
        resolve(matched);
      };

      const onClose = (): void => {
        cleanup();
        reject(new Error('Runtime disconnected before state sync completed.'));
      };

      const onError = (error: unknown): void => {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
      };

      const timeoutId = typeof timeoutMs === 'number'
        ? setTimeout(() => {
            cleanup();
            reject(new Error('Timed out waiting for runtime readiness.'));
          }, timeoutMs)
        : null;

      const cleanup = (): void => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        this.session.off('message', onMessage);
        this.session.off('close', onClose);
        this.session.off('error', onError);
      };

      this.session.on('message', onMessage);
      this.session.on('close', onClose);
      this.session.on('error', onError);
    });
  }

  private setPhase(phase: RuntimePhase): void {
    this.control.phase = phase;
    void this.persistStatus();
  }

  private emitRuntimeEvent<T>(type: string, data: T): void {
    const event: RuntimeEvent<T> = {
      type,
      at: new Date().toISOString(),
      data,
    };
    this.emit('event', event);
  }

  private async log(
    level: RuntimeLogEntry['level'],
    source: string,
    message: string,
    data?: unknown,
  ): Promise<void> {
    const entry: RuntimeLogEntry = {
      at: new Date().toISOString(),
      level,
      source,
      message,
      data,
    };
    await appendRuntimeLog(this.context, entry);
  }

  private async persistStatus(): Promise<void> {
    this.control.updatedAt = new Date().toISOString();
    this.control.painters = [...this.painters.keys()];
    await writeRuntimeControl(this.context, this.control);
  }
}