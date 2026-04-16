import type {
  Action,
  ActionEndPayload,
  ActionStartPayload,
  AgentCreatePayload,
  AgentDeletePayload,
  AgentUpdatePayload,
  ChartGroupMetadata,
  ChartUpdatePayload,
  EnvCreatePayload,
  EnvLayerCreatePayload,
  EnvLayerUpdatePayload,
  LogPayload,
  MetadataUpdatePayload,
  Parameter,
  ParameterChangePayload,
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
      default:
        break;
    }
  }

  onDisconnect(): void {
    this.destroyed = true;
    void this.cleanup();
    this.sendFunc = undefined;
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

  protected async sendEnvCreate(payload: EnvCreatePayload): Promise<void> {
    await this.send({ type: 'env_create', payload });
  }

  protected async sendEnvLayerCreate(payload: EnvLayerCreatePayload): Promise<void> {
    await this.send({ type: 'env_layer_create', payload });
  }

  protected async sendEnvLayerUpdate(payload: EnvLayerUpdatePayload): Promise<void> {
    await this.send({ type: 'env_layer_update', payload });
  }

  protected async sendAgentCreate(payload: AgentCreatePayload): Promise<void> {
    await this.send({ type: 'agent_create', payload });
  }

  protected async sendAgentUpdate(payload: AgentUpdatePayload): Promise<void> {
    await this.send({ type: 'agent_update', payload });
  }

  protected async sendAgentDelete(payload: AgentDeletePayload): Promise<void> {
    await this.send({ type: 'agent_delete', payload });
  }

  protected async sendChartUpdate(payload: ChartUpdatePayload): Promise<void> {
    await this.send({ type: 'chart_update', payload });
  }

  protected async sendLog(payload: LogPayload): Promise<void> {
    await this.send({ type: 'log', payload });
  }

  protected async sendActionEnd(payload: ActionEndPayload): Promise<void> {
    await this.send({ type: 'action_end', payload });
  }

  protected async sendScreenshotRequest(payload: ScreenshotRequestPayload): Promise<void> {
    await this.send({ type: 'screenshot_request', payload });
  }

  protected handleScreenshotResponse?(payload: ScreenshotResponsePayload): void;

  private async sendFullStateSync(): Promise<void> {
    for (const parameter of this.getParameters()) {
      await this.send({ type: 'param_create', payload: parameter });
    }
    for (const action of this.getActions()) {
      await this.send({ type: 'action_create', payload: action });
    }
    for (const env of this.getEnvironments()) {
      await this.send({ type: 'env_create', payload: env });
    }
    for (const chart of this.getCharts()) {
      await this.send({ type: 'chart_create', payload: chart });
    }
  }

  private async handleStateSync(_request: StateSyncRequest): Promise<void> {
    await this.sendFullStateSync();
    await this.sendInitialData();
  }
}
