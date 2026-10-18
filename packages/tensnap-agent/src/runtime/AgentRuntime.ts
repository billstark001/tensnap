import { saveCapturedFrame, readCapturedFrame } from './frame-files';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  decodeRecordingFile,
  encodeRecordingFile,
  inspectRecording,
  type RecordingReport,
} from '@tensnap/core/persistence';
import type { RecordingOptions } from '@tensnap/core/snapshot';
import { writeFileAtomically } from './atomic-file';
import { EventEmitter } from 'node:events';
import type {
  Action,
  ActionResultPayload,
  Parameter,
  ProtocolEncoding,
  ProtocolData,
  ProtocolValidationLevel,
  SceneCaptureResultPayload,
  SceneRestoreEndPayload,
  SceneRestorePayload,
  ScreenshotRequestPayload,
  SimulatorToRendererMessage,
} from '@tensnap/protocol';
import { SceneRestorePayloadSchema } from '@tensnap/protocol';
import { validateIPFamily, parseIPFamily, type IPFamily } from '@tensnap/network';
import {
  ActionRenderError,
  RendererClient,
  RendererSession,
  type BoundedRunSpec,
  type RunStatus,
  type RendererSessionRecordingDetail,
  type SceneRestoreOptions,
} from '@tensnap/core/runtime';
import { ScenarioInspector } from '@tensnap/core/scenario';
import type {
  AgentInspection,
  AgentInspectionOptions,
  AgentRef,
  ScenarioSnapshot,
} from '@tensnap/core/scenario';
import { AgentStorage } from '@tensnap/core/environment';
import { NodeWebSocketTransport } from '../session/NodeWebSocketTransport';
import type {
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
  writeRunRecording,
} from './context';
import {
  normalizeRenderBackgroundColor,
  RenderBatchError,
  renderPainterBatch,
  type RenderArtifact,
  type RenderAssetSource,
  type RenderRequest,
  type ScenePainter,
} from './painter';

export interface AgentRuntimeOptions {
  ip_family?: IPFamily;
  host?: string;
  controlPort?: number | null;
  encoding?: ProtocolEncoding;
  clientMessageValidation?: ProtocolValidationLevel;
  serverMessageValidation?: ProtocolValidationLevel;
  maxRunStepsPolicy?: number;
  render?: Partial<RenderSettings>;
  /** Delay between dirty scene updates and disk checkpoints. */
  checkpointIntervalMs?: number;
  /** Injectable recording store; failures remain queryable on the run. */
  recordingWriter?: typeof writeRunRecording;
  /** Injectable for checkpoint regression tests and alternative durable stores. */
  checkpointWriter?: (context: RuntimeContextPaths, snapshot: ScenarioSnapshot) => Promise<void>;
}

export interface RunRecordingPersistence {
  status: 'pending' | 'persisted' | 'failed';
  path?: string;
  error?: string;
}

export interface RecordingStatus {
  id: string;
  runId?: string;
  status: 'recording' | 'pending' | 'persisted' | 'failed';
  path?: string;
  error?: string;
  report?: RecordingReport;
  options?: RecordingOptions;
}

export interface ActionSettlement {
  requestId: string;
  actionId: string;
  settled: boolean;
  stateKnown: boolean;
  status: 'accepted' | 'succeeded' | 'failed' | 'unknown';
  timeBefore?: number;
  timeAfter?: number;
  result?: ActionResultPayload;
  renderStatus: 'pending' | 'completed' | 'failed' | 'unknown';
  error?: string;
}

interface RuntimeRenderRequest extends RenderRequest {
  sceneRevision: number;
}

const DEFAULT_CHECKPOINT_INTERVAL_MS = 2_000;

const cloneValue = <T>(value: T): T => structuredClone(value);

function summarizeEnvironments(snapshot: ScenarioSnapshot): SceneSummary['environments'] {
  return snapshot.environments.map((environment) => ({
    id: environment.id,
    type: environment.type,
    layerCount: environment.layers.length,
    layerIds: environment.layers.map((layer) => layer.id),
  }));
}

/** Node host for the shared renderer client, headless painting, checkpoints, and control events. */
export class AgentRuntime extends EventEmitter {
  private readonly client: RendererClient;
  private readonly renderer: RendererSession;
  private readonly recordingEntries = new Map<string, RecordingStatus>();
  private manualRecordingId: string | null = null;
  private readonly actionBoundaryTimes = new Map<
    string,
    { id: string; timeBefore?: number; timeAfter?: number }
  >();
  private readonly actionResults = new Map<string, ActionSettlement>();
  private readonly actionCompletions = new Map<string, Promise<ActionSettlement>>();
  private readonly painters = new Map<string, ScenePainter>();
  private readonly control: RuntimeControlFile;
  private readonly recordingCompletionByRun = new Map<string, Promise<void>>();
  private readonly recordingWrites = new Set<Promise<void>>();
  private readonly recordingResults = new Map<string, RunRecordingPersistence>();
  private readonly recordingWriter: typeof writeRunRecording;
  private completedStateSyncCount = 0;
  private connectionGeneration = 0;
  private readonly checkpointIntervalMs: number;
  private checkpointTimer: ReturnType<typeof setTimeout> | null = null;
  private checkpointChain: Promise<void> = Promise.resolve();
  private pendingCheckpoint: { revision: number; promise: Promise<void> } | null = null;
  private statusWriteChain: Promise<void> = Promise.resolve();
  private readonly checkpointWriter: (
    context: RuntimeContextPaths,
    snapshot: ScenarioSnapshot,
  ) => Promise<void>;

  constructor(
    readonly context: RuntimeContextPaths,
    options: AgentRuntimeOptions = {},
  ) {
    super();

    this.client = new RendererClient({
      run: {
        maxStepsPolicy: options.maxRunStepsPolicy,
        renderBarrier: { wait: (_task, payload) => this.renderActionResult(payload) },
      },
    });
    this.renderer = this.client.renderer;
    const requestedCheckpointInterval =
      options.checkpointIntervalMs ?? DEFAULT_CHECKPOINT_INTERVAL_MS;
    this.checkpointIntervalMs = Number.isFinite(requestedCheckpointInterval)
      ? Math.min(5_000, Math.max(1_000, requestedCheckpointInterval))
      : DEFAULT_CHECKPOINT_INTERVAL_MS;
    this.checkpointWriter = options.checkpointWriter ?? writeSceneSnapshot;

    const now = new Date().toISOString();
    this.control = {
      version: 1,
      contextName: context.contextName,
      contextDir: context.contextDir,
      createdAt: now,
      updatedAt: now,
      host: options.host ?? '127.0.0.1',
      ip_family: parseIPFamily(options.ip_family),
      controlPort: options.controlPort ?? null,
      pid: process.pid,
      phase: 'idle',
      encoding: options.encoding ?? 'msgpack',
      clientMessageValidation: options.clientMessageValidation ?? 'off',
      serverMessageValidation: options.serverMessageValidation ?? 'off',
      maxRunStepsPolicy: options.maxRunStepsPolicy ?? 1_000_000,
      render: {
        trigger: options.render?.trigger ?? 'manual',
        backgroundColor: normalizeRenderBackgroundColor(options.render?.backgroundColor),
      },
      painters: [],
      sceneRevision: 0,
      sceneDirty: false,
    };

    this.recordingWriter = options.recordingWriter ?? writeRunRecording;
    this.bindRenderer();
  }

  async initialize(): Promise<void> {
    await ensureRuntimeContext(this.context);
    await this.persistStatus();
    await this.log('info', 'runtime', 'Runtime initialized.', {
      context: this.context.contextName,
    });
  }

  /** Connect to a simulator and start its initial sync; call waitUntilReady before reading the scene. */
  async connect(options: ConnectOptions): Promise<RuntimeStatus> {
    // Own scalar options and resolved defaults before status persistence suspends.
    const connection = {
      ...options,
      ip_family: parseIPFamily(options.ip_family ?? this.control.ip_family),
      encoding: options.encoding ?? this.control.encoding,
      clientMessageValidation:
        options.clientMessageValidation ?? this.control.clientMessageValidation,
      serverMessageValidation:
        options.serverMessageValidation ?? this.control.serverMessageValidation,
    };
    validateIPFamily(new URL(connection.simulatorUrl).hostname, connection.ip_family);
    const generation = ++this.connectionGeneration;
    const assertCurrent = () => {
      if (generation !== this.connectionGeneration)
        throw new Error('Connection attempt was cancelled.');
    };
    this.setPhase('connecting');
    this.control.simulatorUrl = connection.simulatorUrl;
    this.control.ip_family = connection.ip_family;
    this.control.encoding = connection.encoding;
    this.control.clientMessageValidation = connection.clientMessageValidation;
    this.control.serverMessageValidation = connection.serverMessageValidation;
    this.completedStateSyncCount = 0;
    await this.persistStatus();

    try {
      assertCurrent();
      this.client.disconnect();
      this.renderer.scenario.reset();
      this.renderer.run.reset();
      await this.client.connect(
        new NodeWebSocketTransport(connection.simulatorUrl, connection.encoding, {
          ip_family: connection.ip_family,
          clientMessages: connection.clientMessageValidation,
          serverMessages: connection.serverMessageValidation,
        }),
      );
      assertCurrent();
      await this.log('info', 'runtime', 'Connected to simulator.', {
        simulatorUrl: connection.simulatorUrl,
        encoding: connection.encoding,
        clientMessageValidation: connection.clientMessageValidation,
        serverMessageValidation: connection.serverMessageValidation,
      });
      assertCurrent();
      return this.getStatus();
    } catch (error) {
      // A retired operation must not overwrite the current connection's phase/error.
      assertCurrent();
      this.control.lastError = error instanceof Error ? error.message : String(error);
      this.setPhase('error');
      await this.log('error', 'runtime', 'Failed to connect to simulator.', {
        error: this.control.lastError,
      });
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    const generation = ++this.connectionGeneration;
    const wasConnected = this.renderer.isConnected;
    if (wasConnected) this.setPhase('stopping');
    // Cancel pending handshakes even before the renderer has an installed transport.
    this.client.disconnect();
    await this.checkpointScene();
    if (generation !== this.connectionGeneration) return;
    this.setPhase('idle');
    if (wasConnected) await this.log('info', 'runtime', 'Disconnected from simulator.');
  }

  async stop(): Promise<void> {
    this.setPhase('stopping');
    await this.disconnect();
    await this.checkpointScene();
    await Promise.all(this.recordingWrites);
    this.control.pid = null;
    this.control.controlPort = null;
    this.setPhase('stopped');
    await this.persistStatus();
  }

  getStatus(): RuntimeStatus {
    return {
      ...this.control,
      render: { ...this.control.render },
      painters: [...this.control.painters],
      isConnected: this.renderer.isConnected,
      simulatorCapabilities: this.renderer.simulatorInfo?.capabilities,
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
    this.persistStatusInBackground();
    this.emitRuntimeEvent('render.painter.registered', { painterId: painter.id });
  }

  unregisterPainter(id: string): void {
    if (!this.painters.delete(id)) {
      return;
    }

    this.control.painters = [...this.painters.keys()];
    this.persistStatusInBackground();
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
    if (
      Number.isFinite(numericId) &&
      String(numericId) === rawAgentId &&
      layer.storage.hasAgent(numericId)
    ) {
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
    const request = this.createRenderRequest(
      {
        ...options,
        envId: inspection.environmentId,
        viewport: options.viewport ?? inspection.viewport,
        includeData: options.includeData ?? true,
        persist: options.persist ?? false,
        // Inspection renders are always snapshots; never calculate a second
        // force layout in a headless painter.
        readOnlyGraphLayout: true,
      },
      `agent-inspection:${inspection.environmentId}/${inspection.layerId}/${inspection.ref.agentId}`,
      'explicit',
      structuredClone(inspection.renderSnapshot),
    );
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

  /** Refresh the projected scene and wait until the transaction commits. */
  async syncScene(): Promise<void> {
    const targetSyncCount = this.completedStateSyncCount + 1;
    this.assertConnected();
    this.setPhase('syncing');
    const synchronized = this.client.sync();
    void synchronized.catch(() => {});
    await this.log('info', 'scene', 'State sync requested.');
    this.emitRuntimeEvent('scene.sync.requested', {});
    await synchronized;
    await this.waitForStateSync(targetSyncCount);
  }

  /** Capture an exact simulator checkpoint; the protocol result is preserved verbatim. */
  async captureScene(): Promise<SceneCaptureResultPayload> {
    this.assertConnected();
    const result = await this.renderer.captureScene();
    await this.log('info', 'scene', 'Scene checkpoint captured.', {
      requestId: result.request_id,
      encoding: result.checkpoint.encoding,
    });
    this.emitRuntimeEvent('scene.capture.completed', { requestId: result.request_id, result });
    return result;
  }

  /** Restore an exact and/or projected scene through the normal protocol transaction. */
  async restoreScene(
    input: unknown,
    options: SceneRestoreOptions = {},
  ): Promise<SceneRestoreEndPayload> {
    this.assertConnected();
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new Error('scene restore payload must be an object.');
    }
    const info = this.renderer.simulatorInfo;
    if (!info) throw new Error('Wait for simulator_info before restoring a scene.');
    const requestId = `restore-${crypto.randomUUID()}`;
    const parsed = SceneRestorePayloadSchema.parse({
      ...(input as Record<string, unknown>),
      request_id: requestId,
      model_id: info.model.id,
      expected_instance_id:
        (input as Partial<SceneRestorePayload>).expected_instance_id ?? info.instance_id,
      state_schema_version:
        (input as Partial<SceneRestorePayload>).state_schema_version ??
        info.model.state_schema_version,
    });
    const result = await this.renderer.restoreScene(parsed, options);
    await this.log(
      result.status === 'ok' ? 'info' : 'warn',
      'scene',
      'Scene restore completed.',
      result,
    );
    this.emitRuntimeEvent('scene.restore.completed', { requestId, result });
    return result;
  }

  /** Wait for the first completed state sync on this connection. */
  async waitUntilReady(timeoutMs?: number): Promise<RuntimeStatus> {
    return await this.waitForStateSync(1, timeoutMs);
  }

  /** Request a parameter change; the simulator may later normalize it with param_sync. */
  async setParameter(id: string, value: ProtocolData): Promise<void> {
    this.assertConnected();
    this.renderer.setParameter(id, value);
    await this.log('info', 'param', 'Parameter change requested.', { id, value });
    this.emitRuntimeEvent('param.change.requested', { id, value });
  }

  /** Dispatch once; the completion is retained independently of subsequent runs. */
  async runAction(id: string): Promise<string> {
    this.assertConnected();
    const { requestId, completion } = this.client.beginAction(id, 30_000, {
      retainMessages: false,
    });
    const timeBefore = this.actionBoundaryTimes.get(requestId)?.timeBefore;
    this.actionResults.set(requestId, {
      requestId,
      actionId: id,
      settled: false,
      stateKnown: true,
      status: 'accepted',
      renderStatus: 'pending',
      ...(typeof timeBefore === 'number' ? { timeBefore } : {}),
    });
    const finish = completion
      .then(
        ({ result }) => {
          const timeAfter = this.actionBoundaryTimes.get(requestId)?.timeAfter;
          this.actionResults.set(requestId, {
            ...this.actionResults.get(requestId)!,
            settled: true,
            status: result.error ? 'failed' : 'succeeded',
            result,
            renderStatus: 'completed',
            ...(typeof timeAfter === 'number' ? { timeAfter } : {}),
          });
        },
        (error: unknown) => {
          const result = error instanceof ActionRenderError ? error.result : undefined;
          this.actionResults.set(requestId, {
            ...this.actionResults.get(requestId)!,
            settled: true,
            stateKnown: error instanceof ActionRenderError && error.renderStatus === 'failed',
            status:
              error instanceof ActionRenderError && error.renderStatus === 'failed'
                ? 'failed'
                : 'unknown',
            ...(result ? { result } : {}),
            renderStatus: error instanceof ActionRenderError ? error.renderStatus : 'unknown',
            error: error instanceof Error ? error.message : String(error),
          });
        },
      )
      .then(() => {
        this.actionCompletions.delete(requestId);
        this.actionBoundaryTimes.delete(requestId);
        const settled = structuredClone(this.actionResults.get(requestId)!);
        this.emitRuntimeEvent('action.settled', settled);
        while (this.actionResults.size > 100) {
          const expired = [...this.actionResults].find(([, value]) => value.settled);
          if (!expired) break;
          this.actionResults.delete(expired[0]);
        }
        return settled;
      });
    this.actionCompletions.set(requestId, finish);
    await this.log('info', 'action', 'Action requested.', { id, requestId });
    this.emitRuntimeEvent('action.start.requested', { id, requestId });
    return requestId;
  }

  getAction(requestId: string): ActionSettlement | null {
    const value = this.actionResults.get(requestId);
    return value ? structuredClone(value) : null;
  }

  async waitAction(
    requestId: string,
    timeoutMs = 30_000,
    signal?: AbortSignal,
  ): Promise<ActionSettlement> {
    if (!this.actionResults.has(requestId))
      throw new Error('Unknown or expired action request ID.');
    const pending = this.actionCompletions.get(requestId);
    if (pending) return await waitWithoutCancelling(pending, timeoutMs, signal);
    return this.getAction(requestId)!;
  }

  async waitRun(
    id: string,
    until: 'settled' | 'persisted' = 'settled',
    timeoutMs = 30_000,
    signal?: AbortSignal,
  ) {
    const startedAt = Date.now();
    const settled = await this.renderer.run.waitForSettled(id, timeoutMs, signal);
    if (until === 'persisted') {
      if (!settled.spec.record) throw new Error('This run did not request recording persistence.');
      const pending = this.recordingCompletionByRun.get(id);
      if (pending)
        await waitWithoutCancelling(
          pending,
          Math.max(1, timeoutMs - (Date.now() - startedAt)),
          signal,
        );
    }
    const recording = this.recordingResults.get(id);
    return { ...settled, ...(recording ? { recording: structuredClone(recording) } : {}) };
  }

  async saveFrame(
    output: string,
    options: {
      checkpoint?: 'none' | 'if-supported' | 'required';
      envIds?: string[];
      chartIds?: string[];
      renderOptions?: SceneRenderOptions;
      timeoutMs?: number;
    } = {},
  ) {
    this.assertConnected();
    const frame = await this.renderer.captureFrame({
      checkpoint: options.checkpoint,
      timeoutMs: options.timeoutMs,
    });
    return saveCapturedFrame(frame, output, {
      ...options,
      render: (request) => this.runPainters(request),
    });
  }

  async restoreFrame(
    directory: string,
    options: {
      mode: 'checkpoint' | 'projected';
      chartPolicy?: import('@tensnap/core/runtime').RestoreChartPolicy;
      historyTime?: number;
      timeoutMs?: number;
    },
    signal?: AbortSignal,
  ) {
    const { frame } = await readCapturedFrame(directory);
    return this.renderer.restoreFrame(frame, { ...options, signal });
  }

  startRecording(options: RecordingOptions = {}): RecordingStatus {
    this.assertConnected();
    if (
      this.renderer.run.hasInFlightAction ||
      (this.renderer.run.status && !this.renderer.run.status.settled)
    )
      throw new Error('Settle the current action/run before starting a manual recording.');
    if ([...this.recordingEntries.values()].some((entry) => entry.status === 'pending'))
      throw new Error('A recording write is pending.');
    const actual = { maxSteps: 10_000, maxBytes: 64 * 1024 * 1024, ringBuffer: true, ...options };
    if (actual.id && this.recordingEntries.has(actual.id))
      throw new Error('Recording ID already exists.');
    const snapshot = this.renderer.startRecording(actual);
    this.manualRecordingId = snapshot.metadata.id;
    const entry = this.recordingEntries.get(snapshot.metadata.id)!;
    entry.options = structuredClone(actual);
    return structuredClone(entry);
  }

  async stopRecording(timeoutMs = 30_000, signal?: AbortSignal): Promise<RecordingStatus> {
    const id = this.manualRecordingId;
    if (!id) throw new Error('No manual recording is active.');
    if (this.renderer.run.hasInFlightAction)
      throw new Error('Wait for the in-flight action before stopping the recording.');
    this.renderer.stopRecording();
    this.manualRecordingId = null;
    const pending = this.recordingCompletionByRun.get(id);
    if (pending) await waitWithoutCancelling(pending, timeoutMs, signal);
    return structuredClone(this.recordingEntries.get(id)!);
  }

  async listRecordings(): Promise<RecordingStatus[]> {
    let files: string[] = [];
    try {
      files = await readdir(this.context.recordingsDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    for (const name of files.filter((file) => file.endsWith('.tensnap-recording.json'))) {
      const path = join(this.context.recordingsDir, name);
      const encodedId = name.slice(0, -'.tensnap-recording.json'.length);
      let id: string;
      try {
        id = decodeURIComponent(encodedId);
      } catch {
        // A malformed external filename must not hide the rest of the catalog.
        continue;
      }
      if (this.recordingEntries.has(id)) continue;
      try {
        const document = decodeRecordingFile(await readFile(path));
        this.recordingEntries.set(id, { id, status: 'persisted', path, report: document.report });
      } catch (error) {
        this.recordingEntries.set(id, { id, status: 'failed', path, error: String(error) });
      }
    }
    const active = this.renderer.recorder.inspect();
    if (active) {
      const entry = this.recordingEntries.get(active.id);
      if (entry) entry.report = active.report;
    }
    return structuredClone([...this.recordingEntries.values()]);
  }

  async exportRecording(id: string, outputPath: string): Promise<RecordingStatus> {
    await this.listRecordings();
    const entry = this.recordingEntries.get(id);
    if (!entry || entry.status !== 'persisted' || !entry.path)
      throw new Error('Recording is not persisted or does not exist.');
    const document = decodeRecordingFile(await readFile(entry.path));
    await writeFileAtomically(
      outputPath,
      encodeRecordingFile(document.snapshot, { origin: document.origin }),
    );
    return { ...structuredClone(entry), path: outputPath };
  }

  startRun(spec: BoundedRunSpec) {
    this.assertConnected();
    if (spec.record) {
      if (this.renderer.recorder.active) throw new Error('A recording is already active.');
      if (spec.record.id && this.recordingEntries.has(spec.record.id))
        throw new Error('Recording ID already exists.');
      if (this.renderer.run.hasInFlightAction)
        throw new Error('Settle the current action before starting a recorded run.');
      for (const result of this.recordingResults.values()) {
        if (result.status === 'pending')
          throw new Error(
            'Wait for the pending recording to persist before starting another recorded run.',
          );
      }
    }
    const status = this.renderer.run.start(spec);
    const boundedSpec = status.spec.mode === 'bounded' ? status.spec : null;
    this.logInBackground('info', 'run', 'Bounded run started.', {
      runId: status.id,
      actionId: status.spec.actionId,
      maxSteps: boundedSpec?.maxSteps,
      stopWhen: boundedSpec?.stopWhen,
      maxWallTimeMs: status.spec.maxWallTimeMs,
    });
    this.emitRuntimeEvent('run.started', status);
    return status;
  }

  getRun(id?: string): (RunStatus & { recording?: RunRecordingPersistence }) | null {
    const status = id ? this.renderer.run.getRun(id) : this.renderer.run.status;
    if (!status) return null;
    const recording = this.recordingResults.get(status.id);
    return { ...status, ...(recording ? { recording: structuredClone(recording) } : {}) };
  }

  stopRun() {
    const status = this.renderer.run.stop();
    if (status) {
      this.logInBackground('info', 'run', 'Bounded run stopped.', {
        runId: status.id,
        completedActions: status.completedActions,
        stopReason: status.stopReason,
      });
      this.emitRuntimeEvent('run.stopped', status);
    }
    return status;
  }

  async requestRender(
    options: SceneRenderOptions = {},
    reason = 'manual',
  ): Promise<RenderArtifact[]> {
    if (options.envId && options.chartId) {
      throw new Error('A render request may target either an environment or a chart, not both.');
    }
    const request = this.createRenderRequest(options, reason, 'explicit');
    const artifacts = await this.runPainters(request);
    try {
      await this.checkpointRenderedScene(request);
    } catch (error) {
      throw new RenderBatchError(artifacts, [
        {
          painterId: 'scene-checkpoint',
          code: 'persistence_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      ]);
    }
    await this.log('info', 'render', 'Render requested.', {
      reason,
      trigger: 'explicit',
      painterCount: this.painters.size,
      artifactCount: artifacts.length,
      envId: request.options.envId,
      chartId: request.options.chartId,
      outputPath: request.options.outputPath,
    });
    this.emitRuntimeEvent('render.requested', {
      reason,
      trigger: 'explicit',
      painterCount: this.painters.size,
      artifactCount: artifacts.length,
      envId: request.options.envId,
      chartId: request.options.chartId,
      outputPath: request.options.outputPath,
    });
    return artifacts;
  }

  private async runPainters(request: RenderRequest): Promise<RenderArtifact[]> {
    return renderPainterBatch([...this.painters.values()], request, async (painter, error) => {
      const message = error instanceof Error ? error.message : String(error);
      await this.log('error', 'render', 'Painter render failed.', {
        painterId: painter.id,
        error: message,
      }).catch(() => {});
      this.emitRuntimeEvent('render.failed', { painterId: painter.id, error: message });
    });
  }

  private createRenderRequest(
    options: SceneRenderOptions,
    reason: string,
    trigger: RenderTriggerMode | 'explicit',
    snapshot?: ScenarioSnapshot,
  ): RuntimeRenderRequest {
    const backgroundColor = normalizeRenderBackgroundColor(
      options.backgroundColor,
      this.control.render.backgroundColor,
    );
    return {
      at: new Date().toISOString(),
      reason,
      trigger,
      sceneRevision: this.control.sceneRevision,
      snapshot: snapshot ?? this.renderer.scenario.dump(),
      options: {
        ...options,
        ...(options.viewport ? { viewport: { ...options.viewport } } : {}),
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
    this.renderer.addEventListener('outbound', (event) => {
      const message = (
        event as CustomEvent<{ message: import('@tensnap/protocol').RendererToSimulatorMessage }>
      ).detail.message;
      if (message.type !== 'action_invoke') return;
      const payload = message.payload as import('@tensnap/protocol').ActionInvokePayload;
      this.actionBoundaryTimes.set(payload.request_id, {
        id: payload.id,
        timeBefore: this.renderer.scenario.time,
      });
      while (this.actionBoundaryTimes.size > 100)
        this.actionBoundaryTimes.delete(this.actionBoundaryTimes.keys().next().value!);
    });
    this.renderer.addEventListener('message', (event) => {
      const message = (event as CustomEvent<{ message: SimulatorToRendererMessage }>).detail
        .message;
      if (message.type !== 'action_result') return;
      const payload = message.payload as ActionResultPayload;
      const timing = this.actionBoundaryTimes.get(payload.request_id);
      if (timing?.id === payload.id) timing.timeAfter = this.renderer.scenario.time;
    });

    this.renderer.addEventListener('recording:start', (event) => {
      const { snapshot } = (event as CustomEvent<RendererSessionRecordingDetail>).detail;
      this.recordingEntries.set(snapshot.metadata.id, {
        id: snapshot.metadata.id,
        status: 'recording',
        report: inspectRecording(snapshot),
      });
    });
    this.renderer.addEventListener('recording:complete', (event) => {
      const { snapshot, runId } = (event as CustomEvent<RendererSessionRecordingDetail>).detail;
      const id = snapshot.metadata.id;
      const entry: RecordingStatus = {
        ...this.recordingEntries.get(id),
        id,
        runId,
        status: 'pending',
        report: inspectRecording(snapshot),
      };
      this.recordingEntries.set(id, entry);
      if (runId) this.recordingResults.set(runId, { status: 'pending' });
      while (this.recordingResults.size > 100) {
        const removable = [...this.recordingResults].find(
          ([, value]) => value.status !== 'pending',
        );
        if (!removable) break;
        this.recordingResults.delete(removable[0]);
        this.recordingCompletionByRun.delete(removable[0]);
      }
      const write = Promise.resolve()
        .then(() => this.recordingWriter(this.context, id, snapshot))
        .then(
          (path) => {
            entry.status = 'persisted';
            entry.path = path;
            if (runId) this.recordingResults.set(runId, { status: 'persisted', path });
          },
          (error: unknown) => {
            entry.status = 'failed';
            entry.error = error instanceof Error ? error.message : String(error);
            if (runId) this.recordingResults.set(runId, { status: 'failed', error: entry.error });
          },
        )
        .then(() => {
          this.emitRuntimeEvent('recording.persistence', { runId, ...entry });
        });
      this.recordingCompletionByRun.set(runId ?? id, write);
      this.recordingWrites.add(write);
      void write.finally(() => {
        this.recordingWrites.delete(write);
        const key = runId ?? id;
        if (this.recordingCompletionByRun.get(key) === write)
          this.recordingCompletionByRun.delete(key);
      });
    });
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
      this.logInBackground('error', 'transport', 'Transport error.', { error: message });
      this.emitRuntimeEvent('transport.error', { error: message });
    });
    this.renderer.addEventListener('transport:validation-warning', (event) => {
      const warning = (event as CustomEvent<{ message: string; direction: string }>).detail;
      this.logInBackground('warn', 'transport', 'Protocol validation warning.', warning);
      this.emitRuntimeEvent('transport.validation-warning', warning);
    });
    this.renderer.addEventListener('run:settled', (event) => {
      const status = (event as CustomEvent<RunStatus>).detail;
      void this.checkpointScene().catch((error) =>
        this.emitRuntimeEvent('scene.persistence-failed', {
          runId: status.id,
          error: String(error),
        }),
      );
    });
    this.renderer.addEventListener('message', (event) => {
      const { message, origin } = (
        event as CustomEvent<{
          message: SimulatorToRendererMessage;
          origin: 'live' | 'state-sync' | 'scene-restore' | 'replay';
        }>
      ).detail;
      void this.handleProtocolMessage(message, origin);
      if (message.type === 'action_result') {
        const payload = message.payload as ActionResultPayload;
        this.logInBackground('info', 'action', 'Action completed.', payload);
        this.emitRuntimeEvent('action.result', payload);
      }
      if (message.type === 'screenshot_request') {
        const payload = message.payload as ScreenshotRequestPayload;
        void this.handleScreenshotRequest(payload).catch((error) =>
          this.emitRuntimeEvent('render.screenshot-failed', {
            requestId: payload.request_id,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    });
  }

  private async handleProtocolMessage(
    message: SimulatorToRendererMessage,
    origin: 'live' | 'state-sync' | 'scene-restore' | 'replay',
  ): Promise<void> {
    this.emitRuntimeEvent('protocol.message', { type: message.type });

    if (message.type === 'state_sync_begin') {
      this.setPhase('syncing');
      this.emitRuntimeEvent('scene.sync.begin', message.payload);
      return;
    }

    if (message.type === 'state_sync_end') {
      this.completedStateSyncCount += 1;
      this.setPhase('ready');
      this.markSceneDirty();
      await this.checkpointScene().catch((error) =>
        this.emitRuntimeEvent('scene.persistence-failed', { error: String(error) }),
      );
      this.emitRuntimeEvent('scene.sync.end', {
        completedCount: this.completedStateSyncCount,
        payload: message.payload,
      });
      return;
    }

    if (message.type === 'scene_restore_end') {
      if ((message.payload as SceneRestoreEndPayload).status === 'ok') {
        this.markSceneDirty();
      }
      return;
    }

    // A state sync or scene restore is committed as one atomic Scenario
    // replacement. Its intermediate messages must not publish dirty state.
    if (origin === 'state-sync' || origin === 'scene-restore') {
      return;
    }

    if (message.type !== 'action_result' && message.type !== 'screenshot_request') {
      this.markSceneDirty();
    }
  }

  private async renderActionResult(payload: ActionResultPayload): Promise<void> {
    if (this.control.render.trigger !== 'action-result') return;
    const request = this.createRenderRequest({}, `action-result:${payload.id}`, 'action-result');
    let artifacts: RenderArtifact[];
    try {
      artifacts = await this.runPainters(request);
    } catch (error) {
      this.emitRuntimeEvent('render.action-failed', {
        actionId: payload.id,
        requestId: payload.request_id,
        ...(error instanceof RenderBatchError
          ? { artifacts: error.artifacts, errors: error.errors }
          : { error: String(error) }),
      });
      throw error;
    }
    try {
      await this.checkpointRenderedScene(request);
    } catch (error) {
      throw new RenderBatchError(artifacts, [
        {
          painterId: 'scene-checkpoint',
          code: 'persistence_failed',
          message: error instanceof Error ? error.message : String(error),
        },
      ]);
    }

    this.logInBackground('info', 'render', 'Auto render executed after action_result.', {
      actionId: payload.id,
      artifactCount: artifacts.length,
    });
    this.emitRuntimeEvent('render.requested', {
      reason: `action-result:${payload.id}`,
      trigger: 'action-result',
      painterCount: this.painters.size,
      artifactCount: artifacts.length,
    });
  }

  private async handleScreenshotRequest(payload: ScreenshotRequestPayload): Promise<void> {
    if (payload.chart_id) {
      try {
        const artifacts = await this.requestRender(
          {
            chartId: payload.chart_id,
            format: payload.format ?? 'png',
            quality: payload.quality,
            includeData: true,
            persist: false,
          },
          `screenshot-request:${payload.request_id}`,
        );
        const artifact = artifacts.find(
          (candidate) => candidate.kind === 'chart' && candidate.data?.length,
        );
        if (!artifact?.data?.length)
          throw new Error(`No chart render artifact was produced for ${payload.chart_id}.`);
        this.renderer.sendScreenshotResponse({
          request_id: payload.request_id,
          data: new Uint8Array(artifact.data),
          mime: artifact.mime,
        });
      } catch (error) {
        this.renderer.sendScreenshotResponse({
          request_id: payload.request_id,
          error: {
            code: 'render_failed',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
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

      const artifact = artifacts.find(
        (candidate) => candidate.kind === 'environment' && candidate.data?.length,
      );
      if (!artifact?.data?.length) {
        this.renderer.sendScreenshotResponse({
          request_id: payload.request_id,
          error: {
            code: 'render_missing',
            message: 'No environment render artifact was produced for screenshot_request.',
          },
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
        error: { code: 'render_failed', message },
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
        source:
          typeof resolved.source === 'string'
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

  private async waitForStateSync(
    minimumCompletedCount: number,
    timeoutMs?: number,
  ): Promise<RuntimeStatus> {
    const evaluate = (): RuntimeStatus | undefined => {
      if (
        this.renderer.isConnected &&
        this.control.phase === 'ready' &&
        this.completedStateSyncCount >= minimumCompletedCount
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

      const timeoutId =
        typeof timeoutMs === 'number'
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
    this.persistStatusInBackground();
  }

  private persistStatusInBackground(): void {
    void this.persistStatus().catch((error) =>
      this.emitRuntimeEvent('runtime.status-write-failed', {
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  private markSceneDirty(): void {
    this.control.sceneRevision += 1;
    this.control.sceneDirty = true;
    if (this.checkpointTimer) return;
    this.checkpointTimer = setTimeout(() => {
      this.checkpointTimer = null;
      void this.checkpointScene().catch((error) =>
        this.emitRuntimeEvent('scene.persistence-failed', { error: String(error) }),
      );
    }, this.checkpointIntervalMs);
  }

  /** Images retain their captured input; the runtime scene cache must retain the latest revision. */
  private checkpointRenderedScene(request: RuntimeRenderRequest): Promise<void> {
    return request.sceneRevision === this.control.sceneRevision
      ? this.checkpointScene(request.snapshot, true)
      : this.checkpointScene();
  }

  /** Serialize checkpoints so an older async write can never overwrite a newer one. */
  private async checkpointScene(snapshot?: ScenarioSnapshot, force = false): Promise<void> {
    if (this.checkpointTimer) {
      clearTimeout(this.checkpointTimer);
      this.checkpointTimer = null;
    }
    if (!force && !this.control.sceneDirty) return this.checkpointChain;

    const revision = this.control.sceneRevision;
    if (!force && this.pendingCheckpoint?.revision === revision)
      return this.pendingCheckpoint.promise;
    const checkpoint = snapshot ?? this.renderer.scenario.dump();
    const write = async () => {
      await this.checkpointWriter(this.context, checkpoint);
      if (revision === this.control.sceneRevision) {
        this.control.sceneDirty = false;
      }
    };
    const queued = this.checkpointChain.then(write, write);
    const pending = { revision, promise: queued };
    this.pendingCheckpoint = pending;
    const clearPending = () => {
      if (this.pendingCheckpoint === pending) this.pendingCheckpoint = null;
    };
    void queued.then(clearPending, clearPending);
    this.checkpointChain = queued.catch((error) => {
      this.control.lastError = error instanceof Error ? error.message : String(error);
    });
    await queued;
  }

  private emitRuntimeEvent<T>(type: string, data: T): void {
    const event: RuntimeEvent<T> = {
      type,
      at: new Date().toISOString(),
      data,
    };
    this.emit('event', event);
  }

  private logInBackground(
    level: RuntimeLogEntry['level'],
    source: string,
    message: string,
    data?: unknown,
  ): void {
    void this.log(level, source, message, data).catch((error) =>
      this.emitRuntimeEvent('runtime.log-write-failed', {
        source,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
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

  private persistStatus(): Promise<void> {
    this.control.updatedAt = new Date().toISOString();
    this.control.painters = [...this.painters.keys()];
    const snapshot = structuredClone(this.control);
    const write = this.statusWriteChain.then(() => writeRuntimeControl(this.context, snapshot));
    this.statusWriteChain = write.catch(() => {});
    return write;
  }
}

/** A wait timeout never cancels the underlying operation or invents a result. */
export function waitWithoutCancelling<T>(
  operation: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    return Promise.reject(new Error('timeoutMs must be positive.'));
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new Error('Wait aborted; operation was not cancelled.'));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting; operation was not cancelled.'));
    }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}
