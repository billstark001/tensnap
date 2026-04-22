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
  ConnectOptions,
  SceneRenderOptions,
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
import type { RenderArtifact, ScenePainter } from './painter';
import type { RenderRequest } from './painter';

export interface AgentRuntimeOptions {
  host?: string;
  controlPort?: number | null;
  encoding?: ProtocolEncoding;
  render?: Partial<RenderSettings>;
}

export class AgentRuntime extends EventEmitter {
  private readonly session = new AgentSession();
  private readonly painters = new Map<string, ScenePainter>();
  private readonly control: RuntimeControlFile;

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
    await this.persistStatus();

    try {
      await this.session.connect({
        url: options.simulatorUrl,
        encoding: this.control.encoding,
      });
      this.setPhase('open');
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

  listParameters() {
    return this.session.getParameters();
  }

  listActions() {
    return this.session.getActions();
  }

  async syncScene(): Promise<void> {
    this.assertConnected();
    this.setPhase('syncing');
    this.session.requestStateSync();
    await this.log('info', 'scene', 'State sync requested.');
    this.emitRuntimeEvent('scene.sync.requested', {});
    this.setPhase('ready');
  }

  async setParameter(id: string, value: unknown): Promise<void> {
    this.assertConnected();
    this.session.setParameter(id, value);
    await this.log('info', 'param', 'Parameter change requested.', { id, value });
    this.emitRuntimeEvent('param.change.requested', { id, value });
  }

  async runAction(id: string, options: ActionRunOptions = {}): Promise<void> {
    this.assertConnected();
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
      this.setPhase('ready');
      this.emitRuntimeEvent('transport.open', { simulatorUrl: this.control.simulatorUrl });
    });
    this.session.on('close', () => {
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

    if (message.type === 'metadata_update') {
      await writeSceneSnapshot(this.context, this.session.getSnapshot());
    }
  }

  private async handleActionEnd(payload: ActionEndPayload): Promise<void> {
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