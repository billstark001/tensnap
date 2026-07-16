import type {
  ActionInvokePayload,
  AssetSyncPayload,
  ErrorPayload,
  ParameterChangePayload,
  RendererToSimulatorMessage,
  SceneCapturePayload,
  SceneRestorePayload,
  ScreenshotResponsePayload,
  SimulatorToRendererMessage,
  SimulatorInfoPayload,
  StateSyncRequest,
} from '@tensnap/protocol';
import { createSimulatorEmitter, SimulatorEmitter } from './SimulatorEmitter';

export interface SimulatorSessionHandlers {
  /** Immutable identity emitted before every other simulator message. */
  simulatorInfo: SimulatorInfoPayload;
  onConnect?(session: SimulatorSession): void | Promise<void>;
  onDisconnect?(session: SimulatorSession): void | Promise<void>;
  onRendererMessage?(
    message: RendererToSimulatorMessage,
    session: SimulatorSession,
  ): void | Promise<void>;
  onStateSync?(payload: StateSyncRequest, session: SimulatorSession): void | Promise<void>;
  onParamChange?(payload: ParameterChangePayload, session: SimulatorSession): void | Promise<void>;
  onActionInvoke?(payload: ActionInvokePayload, session: SimulatorSession): void | Promise<void>;
  onAssetSync?(payload: AssetSyncPayload, session: SimulatorSession): void | Promise<void>;
  onSceneRestore?(payload: SceneRestorePayload, session: SimulatorSession): void | Promise<void>;
  onSceneCapture?(payload: SceneCapturePayload, session: SimulatorSession): void | Promise<void>;
  onScreenshotResponse?(
    payload: ScreenshotResponsePayload,
    session: SimulatorSession,
  ): void | Promise<void>;
  onError?(payload: ErrorPayload, session: SimulatorSession): void | Promise<void>;
}

export type SessionMessageSender = (
  message: SimulatorToRendererMessage,
) => void | Promise<void>;

export class SimulatorSession {
  readonly emitter: SimulatorEmitter;

  private sender?: SessionMessageSender;
  private currentConnectionId?: string;
  private connected = false;

  constructor(private readonly handlers: SimulatorSessionHandlers) {
    this.emitter = createSimulatorEmitter((message) => {
      if (!this.sender) {
        throw new Error('Simulator session is not attached to a sender');
      }
      return this.sender(message);
    });
  }

  get connectionId(): string | undefined {
    return this.currentConnectionId;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  attach(sender: SessionMessageSender, connectionId?: string): void {
    this.sender = sender;
    this.currentConnectionId = connectionId;
  }

  detach(): void {
    this.sender = undefined;
    this.currentConnectionId = undefined;
    this.connected = false;
  }

  async open(connectionId?: string): Promise<void> {
    this.currentConnectionId = connectionId;
    this.connected = true;
    await this.emitter.simulatorInfo(this.handlers.simulatorInfo);
    await this.handlers.onConnect?.(this);
  }

  async close(): Promise<void> {
    if (!this.connected) {
      this.detach();
      return;
    }
    await this.handlers.onDisconnect?.(this);
    this.detach();
  }

  async dispatch(message: RendererToSimulatorMessage): Promise<void> {
    await this.handlers.onRendererMessage?.(message, this);

    switch (message.type) {
      case 'state_sync':
        await this.handlers.onStateSync?.(message.payload as StateSyncRequest, this);
        return;
      case 'param_change':
        await this.handlers.onParamChange?.(message.payload as ParameterChangePayload, this);
        return;
      case 'action_invoke':
        await this.handlers.onActionInvoke?.(message.payload as ActionInvokePayload, this);
        return;
      case 'asset_sync':
        await this.handlers.onAssetSync?.(message.payload as AssetSyncPayload, this);
        return;
      case 'scene_restore':
        await this.handlers.onSceneRestore?.(message.payload as SceneRestorePayload, this);
        return;
      case 'scene_capture':
        await this.handlers.onSceneCapture?.(message.payload as SceneCapturePayload, this);
        return;
      case 'screenshot_response':
        await this.handlers.onScreenshotResponse?.(message.payload as ScreenshotResponsePayload, this);
        return;
      case 'error':
        await this.handlers.onError?.(message.payload as ErrorPayload, this);
        return;
      default: {
        return;
      }
    }
  }
}
