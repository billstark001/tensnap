/**
 * Base class for managing fake WebSocket simulations
 *
 * Provides common functionality for:
 * - Message sending with type safety
 * - State synchronization
 * - Event handling
 * - Lifecycle management
 */

import type {
  SimulatorToRendererMessage,
  RendererToSimulatorMessage,
  Parameter,
  Action,
  ChartGroupMetadata,
  MetadataUpdatePayload,
  AgentCreatePayload,
  AgentUpdatePayload,
  AgentDeletePayload,
  EnvCreatePayload,
  EnvLayerCreatePayload,
  ChartUpdatePayload,
  LogPayload,
  StateSyncRequest,
  ParameterChangePayload,
  ActionStartPayload,
  EnvLayerUpdatePayload,
} from '@tensnap/core';

import { SimulationMetadata } from './types';

type EventHandler = (...args: any[]) => void;

/**
 * Base simulation manager that handles WebSocket communication (v0.2 protocol)
 */
export abstract class BaseSimulationManager {
  protected sendFunc?: (message: SimulatorToRendererMessage) => void;
  protected wsManager?: any;
  private eventHandlers: Map<string, EventHandler[]> = new Map();
  private isDestroyed = false;

  constructor(protected metadata?: SimulationMetadata) {}

  /** Get simulation metadata (used by the WebSocket adapter) */
  public getMetadata(): SimulationMetadata | undefined {
    return this.metadata;
  }

  // #region Event Management

  protected on(event: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(event) ?? [];
    handlers.push(handler);
    this.eventHandlers.set(event, handlers);
  }

  protected off(event: string, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index !== -1) {
        handlers.splice(index, 1);
      }
    }
  }

  protected emit(event: string, ...args: any[]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(...args));
    }
  }

  // #endregion

  // #region Message Sending

  protected async send(message: SimulatorToRendererMessage): Promise<void> {
    if (this.isDestroyed) {
      return;
    }

    if (this.sendFunc) {
      this.sendFunc(message);
    } else {
      console.warn('Send function not ready, message queued:', message);
    }
  }

  /** Send metadata_update (replaces time_step_start + time_step_end) */
  protected async sendMetadataUpdate(payload: MetadataUpdatePayload): Promise<void> {
    await this.send({ type: 'metadata_update', payload });
  }

  /** Send env_create */
  protected async sendEnvCreate(payload: EnvCreatePayload): Promise<void> {
    await this.send({ type: 'env_create', payload });
  }

  /** Send env_layer_create */
  protected async sendEnvLayerCreate(payload: EnvLayerCreatePayload): Promise<void> {
    await this.send({ type: 'env_layer_create', payload });
  }

  /** Send env_layer_update */
  protected async sendEnvLayerUpdate(payload: EnvLayerUpdatePayload): Promise<void> {
    await this.send({ type: 'env_layer_update', payload });
  }

  /** Send agent_create */
  protected async sendAgentCreate(payload: AgentCreatePayload): Promise<void> {
    await this.send({ type: 'agent_create', payload });
  }

  /** Send agent_update */
  protected async sendAgentUpdate(payload: AgentUpdatePayload): Promise<void> {
    await this.send({ type: 'agent_update', payload });
  }

  /** Send agent_delete */
  protected async sendAgentDelete(payload: AgentDeletePayload): Promise<void> {
    await this.send({ type: 'agent_delete', payload });
  }

  /** Send chart_update */
  protected async sendChartUpdate(payload: ChartUpdatePayload): Promise<void> {
    await this.send({ type: 'chart_update', payload });
  }

  /** Send log message */
  protected async sendLog(payload: LogPayload): Promise<void> {
    await this.send({ type: 'log', payload });
  }

  // #endregion

  // #region Abstract Methods

  /** Get all parameters for the simulation */
  protected abstract getParameters(): Parameter[];

  /** Get all actions for the simulation */
  protected abstract getActions(): Action[];

  /** Get all environments for the simulation */
  protected abstract getEnvironments(): Array<{ id: string; type: 'uniform' | '2d' }>;

  /** Get all chart metadata for the simulation */
  protected abstract getCharts(): ChartGroupMetadata[];

  /** Handle parameter change from client */
  protected abstract handleParameterChange(id: string, value: any): void | Promise<void>;

  /** Handle action_start from client */
  protected abstract handleActionStart(id: string, continuous?: boolean): void | Promise<void>;

  /** Initialize the simulation */
  protected abstract initialize(): void | Promise<void>;

  /** Clean up resources */
  protected abstract cleanup(): void | Promise<void>;

  // #endregion

  // #region State Synchronization

  /** Send initial state using individual CUD messages */
  protected async sendFullStateSync(): Promise<void> {
    // Parameters
    for (const param of this.getParameters()) {
      await this.send({ type: 'param_create', payload: param });
    }
    // Actions
    for (const action of this.getActions()) {
      await this.send({ type: 'action_create', payload: action });
    }
    // Environments
    for (const env of this.getEnvironments()) {
      await this.send({ type: 'env_create', payload: env });
    }
    // Charts
    for (const chart of this.getCharts()) {
      await this.send({ type: 'chart_create', payload: chart });
    }
  }

  /** Handle state sync request from client */
  protected async handleStateSync(_request: StateSyncRequest): Promise<void> {
    await this.sendFullStateSync();
  }

  // #endregion

  // #region Message Handling

  public handleMessage(message: RendererToSimulatorMessage): void {
    if (this.isDestroyed) {
      return;
    }

    switch (message.type) {
      case 'state_sync':
        this.handleStateSync(message.payload as StateSyncRequest);
        break;

      case 'param_change': {
        const { id, value } = message.payload as ParameterChangePayload;
        this.handleParameterChange(id, value);
        break;
      }

      case 'action_start': {
        const { id, continuous } = message.payload as ActionStartPayload;
        this.handleActionStart(id, continuous);
        break;
      }

      default:
        console.warn('Unknown message type:', message.type);
    }
  }

  // #endregion

  // #region Lifecycle Management

  public async onReady(
    sendFunc: (message: SimulatorToRendererMessage) => void,
    wsManager: any
  ): Promise<void> {
    this.sendFunc = sendFunc;
    this.wsManager = wsManager;

    if (wsManager?.on) {
      wsManager.on('disconnected', () => this.destroy());
    }

    await this.initialize();
    await this.sendFullStateSync();
  }

  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.cleanup();
    this.eventHandlers.clear();
    this.sendFunc = undefined;
    this.wsManager = undefined;
  }

  // #endregion
}
