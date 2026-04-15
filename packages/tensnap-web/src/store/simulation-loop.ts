import type { ActionEndPayload, RendererToSimulatorMessage } from '@tensnap/core';

const DEFAULT_LOOP_INTERVAL = 40;

export type ActionStartFactory = (id: string, continuous?: boolean) => RendererToSimulatorMessage;
export type MessageSender = (message: RendererToSimulatorMessage) => void;

export class SimulationLoopController {
  private readonly activeTimers = new Map<string, number>();

  constructor(
    private readonly sendMessage: MessageSender,
    private readonly createActionStartMessage: ActionStartFactory,
    private readonly intervalMs = DEFAULT_LOOP_INTERVAL,
  ) {}

  isRunning(actionId: string): boolean {
    return this.activeTimers.has(actionId);
  }

  start(actionId: string): void {
    if (this.activeTimers.has(actionId)) {
      return;
    }
    this.activeTimers.set(actionId, -1);
    this.sendMessage(this.createActionStartMessage(actionId, true));
  }

  stop(actionId?: string): void {
    if (actionId) {
      this.clearTimer(actionId);
      this.activeTimers.delete(actionId);
      return;
    }

    for (const key of this.activeTimers.keys()) {
      this.clearTimer(key);
    }
    this.activeTimers.clear();
  }

  handleActionEnd(payload: ActionEndPayload): void {
    const actionId = payload.id;
    if (!this.activeTimers.has(actionId)) {
      return;
    }

    if (payload.continue === false) {
      this.stop(actionId);
      return;
    }

    this.clearTimer(actionId);
    const timer = window.setTimeout(() => {
      if (!this.activeTimers.has(actionId)) {
        return;
      }
      this.sendMessage(this.createActionStartMessage(actionId, true));
    }, this.intervalMs);

    this.activeTimers.set(actionId, timer);
  }

  dispose(): void {
    this.stop();
  }

  private clearTimer(actionId: string): void {
    const timer = this.activeTimers.get(actionId);
    if (typeof timer === 'number' && timer >= 0) {
      window.clearTimeout(timer);
    }
  }
}
