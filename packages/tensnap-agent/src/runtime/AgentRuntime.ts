import { EventEmitter } from 'node:events';
import type {
  Action,
  ActionEndPayload,
  Parameter,
  ProtocolEncoding,
  ScreenshotRequestPayload,
  SimulatorToRendererMessage,
} from '@tensnap/protocol';
import { RendererSession } from '@tensnap/core/runtime';
import { ScenarioInspector } from '@tensnap/core/scenario';
import type { AgentInspection, AgentInspectionOptions, AgentRef, ScenarioSnapshot } from '@tensnap/core/scenario';
import { AgentStorage } from '@tensnap/core/environment';
import { NodeWebSocketTransport } from '../session/NodeWebSocketTransport';
import type {
  AgentRunSpec,
  ChartSeriesSnapshot,
  ConnectOptions,
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
} from '../types';
import {
  appendRuntimeLog,
  ensureRuntimeContext,
  type RuntimeContextPaths,
  writeRuntimeControl,
  writeSceneSnapshot,
} from './context';
import type { RenderArtifact, RenderAssetSource, RenderRequest, ScenePainter } from './painter';

export interface AgentRuntimeOptions {
  host?: string;
  controlPort?: number | null;
  encoding?: ProtocolEncoding;
  maxRunStepsPolicy?: number;
  render?: Partial<RenderSettings>;
}

function normalizeBackgroundColor(value: string | undefined, fallback = '#000000'): string {
  const trimmed = value?.trim();
  return trimmed || fallback;
}

const cloneValue = <T>(value: T): T => structuredClone(value);

function summarizeEnvironments(snapshot: ScenarioSnapshot): SceneSummary['environments'] {
  return snapshot.environments.map((environment) => ({
    id: environment.id,
    type: environment.type,
    layerCount: environment.layers.length,
    layerIds: environment.layers.map((layer) => layer.id),
  }));
}

export class AgentRuntime extends EventEmitter {
  private readonly renderer: RendererSession;
  private transport: NodeWebSocketTransport | null = null;
  private readonly painters = new Map<string, ScenePainter>();
  private readonly control: RuntimeControlFile;
  private completedStateSyncCount = 0;

  constructor(
    readonly context: RuntimeContextPaths,
    options: AgentRuntimeOptions = {},
  ) {
    super();

    this.renderer = new RendererSession({
      run: { maxStepsPolicy: options.maxRunStepsPolicy },
    });

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
      maxRunStepsPolicy: options.maxRunStepsPolicy ?? 1_000_000,
      render: {
        trigger: options.render?.trigger ?? 'manual',
        backgroundColor: normalizeBackgroundColor(options.render?.backgroundColor),
      },
      painters: [],
    };

    this.bindRenderer();
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
      this.destroyTransport();
      this.renderer.scenario.reset();
      this.renderer.run.reset();
      const transport = new NodeWebSocketTransport(options.simulatorUrl, this.control.encoding);
      this.transport = transport;
      this.renderer.attachTransport(transport);
      await transport.connect();
      this.renderer.requestStateSync();
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
    if (!this.renderer.isConnected) {
      this.setPhase('idle');
      return;
    }

    this.setPhase('stopping');
    this.transport?.disconnect();
    this.destroyTransport();
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
      isConnected: this.renderer.isConnected,
    };
  }

  getRenderSettings(): RenderSettings {
    return structuredClone(this.control.render);
  }

  async setRenderTrigger(trigger: RenderTriggerMode): Promise<RuntimeStatus> {
    this.control.render = { ...this.control.render, trigger };
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
    const snapshot = this.renderer.scenario.dump();
    return {
      metadata: cloneValue(snapshot.metadata),
      time: typeof snapshot.metadata.time === 'number' ? snapshot.metadata.time : undefined,
      environments: summarizeEnvironments(snapshot),
      parameters: this.listParameters(),
      actions: this.listActions(),
      charts: this.renderer.scenario.charts.getAllMeta().map(cloneValue),
      assets: this.listAssets(),
      logs: this.renderer.scenario.logs.map(cloneValue),
    };
  }

  inspectSnapshot(): SceneSnapshotInspection {
    return {
      snapshot: this.renderer.scenario.dump(),
      charts: this.listChartSeries(),
      assets: this.listAssets(),
    };
  }

  /** Resolve an API path id against the live storage without losing numeric ids. */
  findAgentRef(environmentId: string, layerId: string, rawAgentId: string): AgentRef | undefined {
    const layer = this.renderer.scenario.getEnvironment(environmentId)?.layers.get(layerId);
    if (!(layer?.storage instanceof AgentStorage)) {
      return undefined;
    }
    if (layer.storage.hasAgent(rawAgentId)) {
      return { environmentId, layerId, agentId: rawAgentId };
    }
    const numericId = Number(rawAgentId);
    if (Number.isFinite(numericId) && String(numericId) === rawAgentId && layer.storage.hasAgent(numericId)) {
      return { environmentId, layerId, agentId: numericId };
    }
    return undefined;
  }

  inspectAgent(ref: AgentRef, options: AgentInspectionOptions = {}): AgentInspection | undefined {
    return new ScenarioInspector(this.renderer.scenario).inspect(ref, options);
  }

  /**
   * Render the exact filtered scene selected by ScenarioInspector. No parallel
   * inspection rules or graph layout are introduced on the agent host.
   */
  async renderAgentInspection(
    inspection: Exclude<AgentInspection, { kind: 'none' }>,
    options: SceneRenderOptions = {},
  ): Promise<RenderArtifact[]> {
    const request = this.createRenderRequest({
      ...options,
      envId: inspection.environmentId,
      viewport: options.viewport ?? inspection.viewport,
      includeData: options.includeData ?? true,
      persist: options.persist ?? false,
      // Inspection renders are always snapshots; never calculate a second
      // force layout in a headless painter.
      readOnlyGraphLayout: true,
    }, `agent-inspection:${inspection.environmentId}/${inspection.layerId}/${inspection.ref.agentId}`, 'explicit');
    request.snapshot = inspection.renderSnapshot;
    return this.runPainters(request);
  }

  listChartSeries(): ChartSeriesSnapshot[] {
    return this.renderer.scenario.charts.getAllMeta().map((metadata) => ({
      id: metadata.id,
      metadata: cloneValue(metadata),
      points: (this.renderer.scenario.charts.getData(metadata.id) ?? []).map(cloneValue),
    }));
  }

  getChartSeries(id: string): ChartSeriesSnapshot | null {
    return this.listChartSeries().find((chart) => chart.id === id) ?? null;
  }

  listAssets(): SceneAssetSummary[] {
    return this.renderer.scenario.assets.listMeta().map((meta) => {
      const resolved = this.renderer.scenario.assets.get(meta.id);
      return {
        ...cloneValue(meta),
        resolved: Boolean(resolved),
        valueType: !resolved ? 'pending' : typeof resolved.url === 'string' ? 'string' : 'bytes',
      };
    });
  }

  listParameters(): Parameter[] {
    return [...this.renderer.scenario.parameters.values()].map(cloneValue);
  }

  listActions(): Action[] {
    return [...this.renderer.scenario.actions.values()].map(cloneValue);
  }

  async syncScene(): Promise<void> {
    const targetSyncCount = this.completedStateSyncCount + 1;
    this.assertConnected();
    this.setPhase('syncing');
    this.renderer.requestStateSync();
    await this.log('info', 'scene', 'State sync requested.');
    this.emitRuntimeEvent('scene.sync.requested', {});
    await this.waitForStateSync(targetSyncCount);
  }

  async waitUntilReady(timeoutMs?: number): Promise<RuntimeStatus> {
    return await this.waitForStateSync(1, timeoutMs);
  }

  async setParameter(id: string, value: unknown): Promise<void> {
    this.assertConnected();
    this.renderer.setParameter(id, value);
    await this.log('info', 'param', 'Parameter change requested.', { id, value });
    this.emitRuntimeEvent('param.change.requested', { id, value });
  }

  async runAction(id: string): Promise<void> {
    this.assertConnected();
    this.renderer.run.cancelContinuousActions();
    this.renderer.run.requestAction(id);
    await this.log('info', 'action', 'Action requested.', {
      id,
    });
    this.emitRuntimeEvent('action.start.requested', {
      id,
    });
  }

  startRun(spec: AgentRunSpec) {
    this.assertConnected();
    const status = this.renderer.run.start(spec);
    void this.log('info', 'run', 'Bounded run started.', {
      runId: status.id,
      actionId: status.spec.actionId,
      maxSteps: status.spec.maxSteps,
      stopWhen: status.spec.stopWhen,
      maxWallTimeMs: status.spec.maxWallTimeMs,
    });
    this.emitRuntimeEvent('run.started', status);
    return status;
  }

  getRun() {
    return this.renderer.run.status;
  }

  stopRun() {
    const status = this.renderer.run.stop();
    if (status) {
      void this.log('info', 'run', 'Bounded run stopped.', {
        runId: status.id,
        completedSteps: status.completedSteps,
        stopReason: status.stopReason,
      });
      this.emitRuntimeEvent('run.stopped', status);
    }
    return status;
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
    const backgroundColor = normalizeBackgroundColor(options.backgroundColor, this.control.render.backgroundColor);
    return {
      at: new Date().toISOString(),
      reason,
      trigger,
      snapshot: this.renderer.scenario.dump(),
      options: {
        ...options,
        backgroundColor,
      },
      assets: this.getAssetSources(),
    };
  }

  async setControlAddress(host: string, controlPort: number): Promise<void> {
    this.control.host = host;
    this.control.controlPort = controlPort;
    await this.persistStatus();
  }

  private bindRenderer(): void {
    this.renderer.addEventListener('transport:open', () => {
      this.setPhase('open');
      this.emitRuntimeEvent('transport.open', { simulatorUrl: this.control.simulatorUrl });
    });
    this.renderer.addEventListener('transport:close', () => {
      this.completedStateSyncCount = 0;
      if (this.control.phase !== 'stopped') {
        this.setPhase('idle');
      }
      this.emitRuntimeEvent('transport.close', { simulatorUrl: this.control.simulatorUrl });
    });
    this.renderer.addEventListener('transport:error', (event) => {
      const error = (event as CustomEvent<unknown>).detail;
      const message = error instanceof Error ? error.message : String(error);
      this.control.lastError = message;
      this.setPhase('error');
      void this.log('error', 'transport', 'Transport error.', { error: message });
      this.emitRuntimeEvent('transport.error', { error: message });
    });
    this.renderer.addEventListener('message', (event) => {
      const { message } = (event as CustomEvent<{ message: SimulatorToRendererMessage }>).detail;
      void this.handleProtocolMessage(message);
      if (message.type === 'action_end') {
        void this.handleActionEnd(message.payload as ActionEndPayload);
      }
      if (message.type === 'screenshot_request') {
        void this.handleScreenshotRequest(message.payload as ScreenshotRequestPayload);
      }
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
      await writeSceneSnapshot(this.context, this.renderer.scenario.dump());
      this.emitRuntimeEvent('scene.sync.end', {
        completedCount: this.completedStateSyncCount,
        payload: message.payload,
      });
      return;
    }

    if (message.type === 'metadata_update') {
      await writeSceneSnapshot(this.context, this.renderer.scenario.dump());
    }
  }

  private async handleActionEnd(payload: ActionEndPayload): Promise<void> {
    try {
      await writeSceneSnapshot(this.context, this.renderer.scenario.dump());
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
      this.renderer.run.markActionRendered(payload);
    }
  }

  private async handleScreenshotRequest(payload: ScreenshotRequestPayload): Promise<void> {
    if (payload.chart_id) {
      this.renderer.sendScreenshotResponse({
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
        this.renderer.sendScreenshotResponse({
          request_id: payload.request_id,
          error: 'No environment render artifact was produced for screenshot_request.',
        });
        return;
      }

      this.renderer.sendScreenshotResponse({
        request_id: payload.request_id,
        data: new Uint8Array(artifact.data),
        mime: artifact.mime,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.renderer.sendScreenshotResponse({
        request_id: payload.request_id,
        error: message,
      });
    }
  }

  private assertConnected(): void {
    if (!this.renderer.isConnected) {
      throw new Error('Runtime is not connected to a simulator.');
    }
  }

  private getAssetSources(): Record<string, RenderAssetSource> {
    const assets: Record<string, RenderAssetSource> = {};
    for (const meta of this.renderer.scenario.assets.listMeta()) {
      const resolved = this.renderer.scenario.assets.get(meta.id);
      if (!resolved) continue;
      assets[meta.id] = {
        id: meta.id,
        hash: meta.hash,
        mime: meta.mime,
        source: typeof resolved.source === 'string'
          ? resolved.source
          : resolved.source instanceof Uint8Array
            ? new Uint8Array(resolved.source)
            : typeof resolved.url === 'string'
              ? resolved.url
              : new Uint8Array(resolved.url),
      };
    }
    return assets;
  }

  private destroyTransport(): void {
    if (!this.transport) return;
    this.renderer.detachTransport();
    this.transport.destroy();
    this.transport = null;
  }

  private async waitForStateSync(
    minimumCompletedCount: number,
    timeoutMs?: number,
  ): Promise<RuntimeStatus> {
    const evaluate = (): RuntimeStatus | undefined => {
      if (
        this.renderer.isConnected
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

      const onError = (event: Event): void => {
        const error = (event as CustomEvent<unknown>).detail;
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
        this.renderer.removeEventListener('message', onMessage);
        this.renderer.removeEventListener('transport:close', onClose);
        this.renderer.removeEventListener('transport:error', onError);
      };

      this.renderer.addEventListener('message', onMessage);
      this.renderer.addEventListener('transport:close', onClose);
      this.renderer.addEventListener('transport:error', onError);
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
