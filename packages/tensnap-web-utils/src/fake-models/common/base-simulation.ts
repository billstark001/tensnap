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
  ServerToClientMessage,
  ClientToServerMessage,
  Environment,
  Parameter,
  ChartGroupMetadata,
  TimeStepStartPayload,
  TimeStepEndPayload,
  EnvironmentUpdatePayload,
  AgentUpdatePayload,
  AgentBatchUpdatePayload,
  ChartUpdatePayload,
  StateSyncResponse,
  LogPayload,
  StateSyncRequest,
  ParameterChangePayload,
  ButtonClickPayload,
} from 'tensnap-web';

import { SimulationMetadata } from './types';

type EventHandler = (...args: any[]) => void;

/**
 * Base simulation manager that handles WebSocket communication
 */
export abstract class BaseSimulationManager {
  protected sendFunc?: (message: ServerToClientMessage) => void;
  protected wsManager?: any;
  private eventHandlers: Map<string, EventHandler[]> = new Map();
  private isDestroyed = false;

  constructor(protected metadata?: SimulationMetadata) {}

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

  /**
   * Send a message to the client
   */
  protected async send(message: ServerToClientMessage): Promise<void> {
    if (this.isDestroyed) {
      console.warn('Cannot send message: simulation is destroyed');
      return;
    }

    if (this.sendFunc) {
      this.sendFunc(message);
    } else {
      console.warn('Send function not ready, message queued:', message);
    }
  }

  /**
   * Send time_step_start message
   */
  protected async sendTimeStepStart(time: number): Promise<void> {
    await this.send({
      type: 'time_step_start',
      payload: { time } as TimeStepStartPayload,
    });
  }

  /**
   * Send time_step_end message
   */
  protected async sendTimeStepEnd(time?: number): Promise<void> {
    await this.send({
      type: 'time_step_end',
      payload: { time } as TimeStepEndPayload,
    });
  }

  /**
   * Send environment_update message
   */
  protected async sendEnvironmentUpdate(
    payload: EnvironmentUpdatePayload
  ): Promise<void> {
    await this.send({
      type: 'environment_update',
      payload,
    });
  }

  /**
   * Send agent_update message
   */
  protected async sendAgentUpdate(payload: AgentUpdatePayload): Promise<void> {
    await this.send({
      type: 'agent_update',
      payload,
    });
  }

  /**
   * Send agent_batch_update message
   */
  protected async sendAgentBatchUpdate(
    payload: AgentBatchUpdatePayload
  ): Promise<void> {
    await this.send({
      type: 'agent_batch_update',
      payload,
    });
  }

  /**
   * Send chart_update message
   */
  protected async sendChartUpdate(payload: ChartUpdatePayload): Promise<void> {
    await this.send({
      type: 'chart_update',
      payload,
    });
  }

  /**
   * Send state_sync message
   */
  protected async sendStateSync(payload: StateSyncResponse): Promise<void> {
    await this.send({
      type: 'state_sync',
      payload,
    });
  }

  /**
   * Send log message
   */
  protected async sendLog(payload: LogPayload): Promise<void> {
    await this.send({
      type: 'log',
      payload,
    });
  }

  // #endregion

  // #region Abstract Methods - Must be implemented by subclasses

  /**
   * Get all parameters for the simulation
   */
  protected abstract getParameters(): Parameter[];

  /**
   * Get all environments for the simulation
   */
  protected abstract getEnvironments(): Environment[];

  /**
   * Get all chart metadata for the simulation
   */
  protected abstract getCharts(): ChartGroupMetadata[];

  /**
   * Handle parameter change from client
   */
  protected abstract handleParameterChange(
    id: string,
    value: any
  ): void | Promise<void>;

  /**
   * Handle button click from client
   */
  protected abstract handleButtonClick(action: string): void | Promise<void>;

  /**
   * Initialize the simulation
   */
  protected abstract initialize(): void | Promise<void>;

  /**
   * Clean up resources
   */
  protected abstract cleanup(): void | Promise<void>;

  // #endregion

  // #region State Synchronization

  /**
   * Send full state synchronization
   */
  protected async sendFullStateSync(): Promise<void> {
    const response: StateSyncResponse = {
      mode: 'full',
      added_parameters: this.getParameters(),
      removed_parameters: [],
      updated_parameters: [],
      added_environments: this.getEnvironments(),
      removed_environments: [],
      updated_environments: [],
      added_charts: this.getCharts(),
      removed_charts: [],
      updated_charts: [],
    };

    await this.sendStateSync(response);
  }

  /**
   * Handle state sync request from client
   * Override this if you need custom differential sync logic
   */
  protected async handleStateSync(
    _request: StateSyncRequest
  ): Promise<void> {
    // For now, just send full state
    // In a more sophisticated implementation, you could compute diffs
    await this.sendFullStateSync();
  }

  // #endregion

  // #region Message Handling

  /**
   * Handle incoming message from client
   */
  public handleMessage(message: ClientToServerMessage): void {
    if (this.isDestroyed) {
      return;
    }

    switch (message.type) {
      case 'state_sync':
        this.handleStateSync(message.payload as StateSyncRequest);
        break;

      case 'parameter_change': {
        const { id, value } = message.payload as ParameterChangePayload;
        this.handleParameterChange(id, value);
        break;
      }

      case 'button_click': {
        const { action } = message.payload as ButtonClickPayload;
        this.handleButtonClick(action);
        break;
      }

      default:
        console.warn('Unknown message type:', message.type);
    }
  }

  // #endregion

  // #region Lifecycle Management

  /**
   * Called when the WebSocket connection is ready
   */
  public async onReady(
    sendFunc: (message: ServerToClientMessage) => void,
    wsManager: any
  ): Promise<void> {
    this.sendFunc = sendFunc;
    this.wsManager = wsManager;

    // Set up disconnection handler
    if (wsManager?.on) {
      wsManager.on('disconnected', () => this.destroy());
    }

    // Initialize the simulation
    await this.initialize();

    // Send initial state
    await this.sendFullStateSync();
  }

  /**
   * Destroy the simulation and clean up resources
   */
  public async destroy(): Promise<void> {
    if (this.isDestroyed) {
      return;
    }

    this.isDestroyed = true;
    await this.cleanup();
    this.eventHandlers.clear();
    this.sendFunc = undefined;
    this.wsManager = undefined;
  }

  // #endregion

  // #region Utility Methods

  /**
   * Check if simulation is destroyed
   */
  protected isSimulationDestroyed(): boolean {
    return this.isDestroyed;
  }

  /**
   * Get simulation metadata
   */
  public getMetadata(): SimulationMetadata | undefined {
    return this.metadata;
  }

  // #endregion
}
