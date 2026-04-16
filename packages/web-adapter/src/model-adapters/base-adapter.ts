import type {
  Action,
  ActionEndPayload,
  ActionStartPayload,
  AgentCreatePayload,
  AgentDeletePayload,
  AgentUpdatePayload,
  AssetDataPayload,
  AssetDeletePayload,
  AssetMeta,
  AssetMetaPayload,
  AssetSyncPayload,
  ChartDeletePayload,
  ChartGroupMetadata,
  ChartUpdatePayload,
  EdgeCreatePayload,
  EdgeDeletePayload,
  EdgeUpdatePayload,
  EnvCreatePayload,
  EnvDeletePayload,
  EnvLayerCreatePayload,
  EnvLayerDeletePayload,
  EnvLayerUpdatePayload,
  ErrorPayload,
  LogPayload,
  MetadataUpdatePayload,
  Parameter,
  ParameterChangePayload,
  ParameterDeletePayload,
  ParameterSyncPayload,
  RendererToSimulatorMessage,
  ScreenshotRequestPayload,
  ScreenshotResponsePayload,
  SimulatorToRendererMessage,
  StateSyncRequest,
} from '@tensnap/core';
import type { InMemorySimulationHandler } from '../transport';

export interface AdapterMetadata {
  id: string;
  name: string;
  description: string;
}

export abstract class BaseModelAdapter implements InMemorySimulationHandler {
  private sendFunc?: (message: SimulatorToRendererMessage) => void;
  private destroyed = false;

  // Asset registry: id → { hash, mime, data }
  private readonly assetRegistry = new Map<
    string,
    { hash: string; mime: string; data: Uint8Array; label?: string }
  >();

  constructor(readonly metadata: AdapterMetadata) {}

  get connectionId(): string {
    return `inmemory:${this.metadata.id}`;
  }

  protected abstract getParameters(): Parameter[];
  protected abstract getActions(): Action[];
  protected abstract getEnvironments(): Array<{ id: string; type: 'uniform' | '2d' }>;
  protected abstract getCharts(): ChartGroupMetadata[];
  protected abstract handleParameterChange(id: string, value: unknown): void | Promise<void>;
  protected abstract handleActionStart(id: string, continuous?: boolean): void | Promise<void>;
  protected abstract initialize(): void | Promise<void>;
  protected abstract cleanup(): void | Promise<void>;

  async onConnect(send: (msg: SimulatorToRendererMessage) => void): Promise<void> {
    this.sendFunc = send;
    await this.initialize();
    await this.sendFullStateSync();
    await this.sendInitialData();
  }

  async onMessage(msg: RendererToSimulatorMessage): Promise<void> {
    if (this.destroyed) {
      return;
    }

    switch (msg.type) {
      case 'state_sync':
        await this.handleStateSync(msg.payload as StateSyncRequest);
        break;
      case 'param_change': {
        const payload = msg.payload as ParameterChangePayload;
        await this.handleParameterChange(payload.id, payload.value);
        break;
      }
      case 'action_start': {
        const payload = msg.payload as ActionStartPayload;
        await this.handleActionStart(payload.id, payload.continuous);
        break;
      }
      case 'screenshot_response': {
        const payload = msg.payload as ScreenshotResponsePayload;
        this.handleScreenshotResponse?.(payload);
        break;
      }
      case 'asset_sync': {
        const payload = msg.payload as AssetSyncPayload;
        await this.handleAssetSync(payload);
        break;
      }
      case 'error': {
        const payload = msg.payload as ErrorPayload;
        this.handleError?.(payload);
        break;
      }
      default:
        break;
    }
  }

  onDisconnect(): void {
    this.destroyed = true;
    void this.cleanup();
    this.sendFunc = undefined;
    this.assetRegistry.clear();
  }

  protected async sendInitialData(): Promise<void> {
    // no-op by default
  }

  protected async send(message: SimulatorToRendererMessage): Promise<void> {
    if (this.destroyed || !this.sendFunc) {
      return;
    }
    this.sendFunc(message);
  }

  protected async sendMetadataUpdate(payload: MetadataUpdatePayload): Promise<void> {
    await this.send({ type: 'metadata_update', payload });
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  protected async sendActionEnd(payload: ActionEndPayload): Promise<void> {
    await this.send({ type: 'action_end', payload });
  }

  protected async sendActionCreate(payload: Action): Promise<void> {
    await this.send({ type: 'action_create', payload });
  }

  protected async sendActionUpdate(payload: Action): Promise<void> {
    await this.send({ type: 'action_update', payload });
  }

  protected async sendActionDelete(payload: { id: string }): Promise<void> {
    await this.send({ type: 'action_delete', payload });
  }

  // ── Parameters ───────────────────────────────────────────────────────────

  protected async sendParamCreate(payload: Parameter): Promise<void> {
    await this.send({ type: 'param_create', payload });
  }

  protected async sendParamUpdate(payload: Parameter): Promise<void> {
    await this.send({ type: 'param_update', payload });
  }

  protected async sendParamDelete(payload: ParameterDeletePayload): Promise<void> {
    await this.send({ type: 'param_delete', payload });
  }

  protected async sendParamSync(payload: ParameterSyncPayload): Promise<void> {
    await this.send({ type: 'param_sync', payload });
  }

  // ── Environments ─────────────────────────────────────────────────────────

  protected async sendEnvCreate(payload: EnvCreatePayload): Promise<void> {
    await this.send({ type: 'env_create', payload });
  }

  protected async sendEnvDelete(payload: EnvDeletePayload): Promise<void> {
    await this.send({ type: 'env_delete', payload });
  }

  protected async sendEnvLayerCreate(payload: EnvLayerCreatePayload): Promise<void> {
    await this.send({ type: 'env_layer_create', payload });
  }

  protected async sendEnvLayerUpdate(payload: EnvLayerUpdatePayload): Promise<void> {
    await this.send({ type: 'env_layer_update', payload });
  }

  protected async sendEnvLayerDelete(payload: EnvLayerDeletePayload): Promise<void> {
    await this.send({ type: 'env_layer_delete', payload });
  }

  // ── Agents ───────────────────────────────────────────────────────────────

  protected async sendAgentCreate(payload: AgentCreatePayload): Promise<void> {
    await this.send({ type: 'agent_create', payload });
  }

  protected async sendAgentUpdate(payload: AgentUpdatePayload): Promise<void> {
    await this.send({ type: 'agent_update', payload });
  }

  protected async sendAgentDelete(payload: AgentDeletePayload): Promise<void> {
    await this.send({ type: 'agent_delete', payload });
  }

  // ── Edges ────────────────────────────────────────────────────────────────

  protected async sendEdgeCreate(payload: EdgeCreatePayload): Promise<void> {
    await this.send({ type: 'edge_create', payload });
  }

  protected async sendEdgeUpdate(payload: EdgeUpdatePayload): Promise<void> {
    await this.send({ type: 'edge_update', payload });
  }

  protected async sendEdgeDelete(payload: EdgeDeletePayload): Promise<void> {
    await this.send({ type: 'edge_delete', payload });
  }

  // ── Charts ───────────────────────────────────────────────────────────────

  protected async sendChartCreate(payload: ChartGroupMetadata): Promise<void> {
    await this.send({ type: 'chart_create', payload });
  }

  protected async sendChartUpdate(payload: ChartUpdatePayload): Promise<void> {
    await this.send({ type: 'chart_update', payload });
  }

  protected async sendChartDelete(payload: ChartDeletePayload): Promise<void> {
    await this.send({ type: 'chart_delete', payload });
  }

  // ── Assets ───────────────────────────────────────────────────────────────

  protected async sendAssetMeta(payload: AssetMetaPayload): Promise<void> {
    await this.send({ type: 'asset_meta', payload });
  }

  protected async sendAssetData(payload: AssetDataPayload): Promise<void> {
    await this.send({ type: 'asset_data', payload });
  }

  protected async sendAssetDelete(payload: AssetDeletePayload): Promise<void> {
    await this.send({ type: 'asset_delete', payload });
  }

  /**
   * Register a binary asset so it can be transferred to the renderer on demand.
   * Computes a SHA-256 hash of the content for deduplication.
   * Sends asset_meta immediately; asset_data is sent in response to asset_sync.
   */
  protected async registerAsset(
    id: string,
    mime: string,
    data: Uint8Array,
    label?: string,
  ): Promise<void> {
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data.slice());
    const hash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    this.assetRegistry.set(id, { hash, mime, data, label });
    await this.sendAssetMeta({
      assets: [{ id, hash, mime, size: data.byteLength, label } satisfies AssetMeta],
    });
  }

  /**
   * Respond to an asset_sync request from the renderer.
   * Sends asset_data for any asset whose hash differs from what the renderer holds.
   */
  protected async handleAssetSync(payload: AssetSyncPayload): Promise<void> {
    for (const [id, entry] of this.assetRegistry) {
      if (payload.assets[id] !== entry.hash) {
        await this.sendAssetData({ id, hash: entry.hash, mime: entry.mime, data: entry.data });
      }
    }
  }

  // ── Misc ─────────────────────────────────────────────────────────────────

  protected async sendLog(payload: LogPayload): Promise<void> {
    await this.send({ type: 'log', payload });
  }

  protected async sendError(payload: ErrorPayload): Promise<void> {
    await this.send({ type: 'error', payload });
  }

  protected async sendScreenshotRequest(payload: ScreenshotRequestPayload): Promise<void> {
    await this.send({ type: 'screenshot_request', payload });
  }

  protected handleScreenshotResponse?(payload: ScreenshotResponsePayload): void;
  protected handleError?(payload: ErrorPayload): void;

  private async sendFullStateSync(): Promise<void> {
    for (const parameter of this.getParameters()) {
      await this.sendParamCreate(parameter);
    }
    for (const action of this.getActions()) {
      await this.sendActionCreate(action);
    }
    for (const env of this.getEnvironments()) {
      await this.sendEnvCreate(env);
    }
    for (const chart of this.getCharts()) {
      await this.sendChartCreate(chart);
    }
  }

  private async handleStateSync(request: StateSyncRequest): Promise<void> {
    const currentParams = new Map(this.getParameters().map((p) => [p.id, p]));
    const currentActions = new Map(this.getActions().map((a) => [a.id, a]));
    const currentEnvs = new Map(this.getEnvironments().map((e) => [e.id, e]));
    const currentCharts = new Map(this.getCharts().map((c) => [c.id, c]));

    // Parameters: delete renderer-only, create sim-only, update shared
    for (const rp of request.parameters) {
      if (!currentParams.has(rp.id)) {
        await this.sendParamDelete({ id: rp.id });
      }
    }
    for (const [id, param] of currentParams) {
      if (!request.parameters.some((p) => p.id === id)) {
        await this.sendParamCreate(param);
      } else {
        await this.sendParamUpdate(param);
      }
    }

    // Actions: delete renderer-only, create sim-only
    for (const ra of request.actions) {
      if (!currentActions.has(ra.id)) {
        await this.sendActionDelete({ id: ra.id });
      }
    }
    for (const [id, action] of currentActions) {
      if (!request.actions.some((a) => a.id === id)) {
        await this.sendActionCreate(action);
      }
    }

    // Environments: delete renderer-only, delete orphaned layers in shared, create sim-only
    for (const re of request.envs) {
      if (currentEnvs.has(re.id)) {
        // delete all renderer layers for this env so sendInitialData can recreate them fresh
        for (const rl of re.layers) {
          await this.sendEnvLayerDelete({ env_id: re.id, layer_id: rl.layer_id });
        }
      } else {
        await this.sendEnvDelete({ id: re.id });
      }
    }
    for (const [id, env] of currentEnvs) {
      if (!request.envs.some((e) => e.id === id)) {
        await this.sendEnvCreate(env);
      }
    }

    // Charts: delete renderer-only, create sim-only
    for (const rc of request.charts) {
      if (!currentCharts.has(rc.id)) {
        await this.sendChartDelete({ id: rc.id });
      }
    }
    for (const [id, chart] of currentCharts) {
      if (!request.charts.some((c) => c.id === id)) {
        await this.sendChartCreate(chart);
      }
    }

    // Re-send all asset metadata so renderer can request missing data
    for (const [id, entry] of this.assetRegistry) {
      await this.sendAssetMeta({
        assets: [{ id, hash: entry.hash, mime: entry.mime, size: entry.data.byteLength, label: entry.label } satisfies AssetMeta],
      });
    }

    // Re-send current layer/agent/edge data
    await this.sendInitialData();
  }
}
