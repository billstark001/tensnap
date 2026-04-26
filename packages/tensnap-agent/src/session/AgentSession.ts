import { EventEmitter } from 'node:events';
import type { ChartMetadata } from '@tensnap/core/chart';
import type { Parameter } from '@tensnap/core/parameter';
import type {
  ActionEndPayload,
  ProtocolEncoding,
  RendererToSimulatorMessage,
  ScreenshotRequestPayload,
  ScreenshotResponsePayload,
  SimulatorToRendererMessage,
  StateSyncBoundaryPayload,
} from '@tensnap/core/protocol';
import { PipelineRuntime } from '@tensnap/core/runtime';
import { Scenario, type ScenarioSnapshot } from '@tensnap/core/scenario';
import { getReservedSceneActionAlias, getReservedSceneActionId, type SceneReservedAction } from './reserved-actions';
import { NodeWebSocketTransport } from './NodeWebSocketTransport';
import type {
  ActionSummary,
  ChartSeriesSnapshot,
  SceneAssetSummary,
  SceneEnvironmentSummary,
  SceneSummary,
} from '../types';
import type { RenderAssetSource } from '../runtime/painter';

export interface SessionConnectOptions {
  url: string;
  encoding?: ProtocolEncoding;
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function summarizeEnvironments(snapshot: ScenarioSnapshot): SceneEnvironmentSummary[] {
  return snapshot.environments.map((environment) => ({
    id: environment.id,
    type: environment.type,
    layerCount: environment.layers.length,
    layerIds: environment.layers.map((layer) => layer.id),
  }));
}

export class AgentSession extends EventEmitter {
  readonly scenario = new Scenario();

  private readonly runtime = new PipelineRuntime();
  private transport: NodeWebSocketTransport | null = null;
  private currentUrl: string | null = null;
  private currentEncoding: ProtocolEncoding = 'msgpack';

  get isConnected(): boolean {
    return this.transport?.isConnected ?? false;
  }

  get url(): string | null {
    return this.currentUrl;
  }

  get encoding(): ProtocolEncoding {
    return this.currentEncoding;
  }

  async connect(options: SessionConnectOptions): Promise<void> {
    this.destroyTransport();
    this.scenario.reset();
    this.runtime.reset();

    const transport = new NodeWebSocketTransport(options.url, options.encoding ?? 'msgpack');
    this.transport = transport;
    this.currentUrl = options.url;
    this.currentEncoding = options.encoding ?? 'msgpack';
    this.bindTransport(transport);

    await transport.connect();
    this.requestStateSync();
  }

  async disconnect(): Promise<void> {
    if (!this.transport) {
      return;
    }

    this.transport.disconnect();
    this.destroyTransport();
  }

  destroy(): void {
    this.destroyTransport();
    this.runtime.reset();
    this.removeAllListeners();
  }

  requestStateSync(): void {
    const requestId = this.createRuntimeRequestId('sync');
    this.runtime.requestStateSync(requestId);
    this.send(this.scenario.createStateSyncMessage(requestId));
  }

  setParameter(id: string, value: unknown): void {
    this.send(this.scenario.createParamChangeMessage(id, value));
  }

  runAction(id: string, continuous?: boolean): void {
    this.runtime.enqueue(id, { continuous: continuous ?? false });
    this.flushRuntimeCommands();
  }

  cancelContinuousActions(actionId?: string): void {
    this.runtime.cancel(actionId);
  }

  markActionRendered(payload: Pick<ActionEndPayload, 'id' | 'tick_id'>): boolean {
    const task = this.resolveRuntimeTask(payload);
    if (!task) {
      return false;
    }

    const rendered = this.runtime.markTaskRendered(task.id);
    if (rendered) {
      this.flushRuntimeCommands();
    }
    return rendered;
  }

  runReservedAction(alias: SceneReservedAction, continuous?: boolean): void {
    this.runAction(getReservedSceneActionId(alias), continuous);
  }

  getSnapshot(): ScenarioSnapshot {
    return this.scenario.dump();
  }

  getParameters(): Parameter[] {
    return [...this.scenario.parameters.values()].map(cloneValue);
  }

  getActions(): ActionSummary[] {
    return [...this.scenario.actions.values()].map((action) => ({
      ...cloneValue(action),
      reserved: getReservedSceneActionAlias(action.id),
    }));
  }

  getCharts(): ChartMetadata[] {
    return this.scenario.charts.getAllMeta().map(cloneValue);
  }

  listChartSeries(): ChartSeriesSnapshot[] {
    return this.getCharts().map((metadata) => ({
      id: metadata.id,
      metadata,
      points: (this.scenario.charts.getData(metadata.id) ?? []).map(cloneValue),
    }));
  }

  getChartSeries(id: string): ChartSeriesSnapshot | null {
    const metadata = this.getCharts().find((chart) => chart.id === id);
    if (!metadata) {
      return null;
    }

    return {
      id,
      metadata,
      points: (this.scenario.charts.getData(id) ?? []).map(cloneValue),
    };
  }

  listAssets(): SceneAssetSummary[] {
    return this.scenario.assets.listMeta().map((meta) => {
      const resolved = this.scenario.assets.get(meta.id);
      return {
        ...cloneValue(meta),
        resolved: Boolean(resolved),
        valueType: !resolved ? 'pending' : typeof resolved.url === 'string' ? 'string' : 'bytes',
      };
    });
  }

  getSceneSummary(): SceneSummary {
    const snapshot = this.getSnapshot();
    return {
      metadata: cloneValue(snapshot.metadata),
      time: typeof snapshot.metadata.time === 'number' ? snapshot.metadata.time : undefined,
      environments: summarizeEnvironments(snapshot),
      parameters: this.getParameters(),
      actions: this.getActions(),
      charts: this.getCharts(),
      assets: this.listAssets(),
      logs: this.scenario.logs.map(cloneValue),
    };
  }

  getAssetSources(): Record<string, RenderAssetSource> {
    const assets: Record<string, RenderAssetSource> = {};
    for (const meta of this.scenario.assets.listMeta()) {
      const resolved = this.scenario.assets.get(meta.id);
      if (!resolved) {
        continue;
      }

      assets[meta.id] = {
        id: meta.id,
        hash: meta.hash,
        mime: meta.mime,
        source: typeof resolved.url === 'string' ? resolved.url : new Uint8Array(resolved.url),
      };
    }
    return assets;
  }

  sendScreenshotResponse(payload: ScreenshotResponsePayload): void {
    this.send(this.scenario.createScreenshotResponseMessage(payload));
  }

  private bindTransport(transport: NodeWebSocketTransport): void {
    transport.on('open', () => this.emit('open'));
    transport.on('close', () => this.emit('close'));
    transport.on('error', (error) => this.emit('error', error));
    transport.on('message', (message) => this.handleMessage(message as SimulatorToRendererMessage));
  }

  private handleMessage(message: SimulatorToRendererMessage): void {
    this.scenario.apply(message);

    if (message.type === 'state_sync_begin') {
      this.runtime.recordStateSyncBoundary('begin', message.payload as StateSyncBoundaryPayload);
    }

    if (message.type === 'state_sync_end') {
      this.runtime.recordStateSyncBoundary('end', message.payload as StateSyncBoundaryPayload);
      this.flushRuntimeCommands();
    }

    if (message.type === 'asset_meta') {
      this.send(this.scenario.createAssetSyncMessage());
    }

    if (message.type === 'screenshot_request') {
      this.emit('screenshot-request', message.payload as ScreenshotRequestPayload);
    }

    if (message.type === 'action_end') {
      const payload = message.payload as ActionEndPayload;
      const task = this.resolveRuntimeTask(payload);
      if (task) {
        this.runtime.completeTask(task.id, {
          continue: payload.continue,
          timings: payload.timings,
        });
        this.runtime.markTaskApplied(task.id);
      }
      this.emit('action-end', payload);
    }

    this.emit('message', message);
  }

  private resolveRuntimeTask(payload: Pick<ActionEndPayload, 'id' | 'tick_id'>) {
    const activeTask = this.runtime.peekActiveTask();
    if (!activeTask) {
      return null;
    }

    if (payload.tick_id) {
      return activeTask.id === payload.tick_id ? activeTask : null;
    }

    return activeTask.key === payload.id ? activeTask : null;
  }

  private flushRuntimeCommands(): void {
    const commands = this.runtime.consumeCommands();
    for (const command of commands) {
      if (command.type !== 'dispatch') {
        continue;
      }

      this.send(
        this.scenario.createActionStartMessage(
          command.task.key,
          command.task.continuous,
          command.task.id,
        ),
      );
    }
  }

  private createRuntimeRequestId(prefix: string): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}-${crypto.randomUUID()}`;
    }

    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private send(message: RendererToSimulatorMessage): void {
    if (!this.transport) {
      throw new Error('Session is not connected.');
    }

    this.transport.send(message);
  }

  private destroyTransport(): void {
    if (!this.transport) {
      return;
    }

    this.transport.destroy();
    this.transport = null;
    this.currentUrl = null;
    this.runtime.reset();
  }
}