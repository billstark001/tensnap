import type {
  ActionEndPayload,
  RendererToSimulatorMessage,
  SimulatorToRendererMessage,
} from '@tensnap/protocol';
import { encodeBytesAsDataUrl } from '@tensnap/protocol';
import { Scenario } from '../scenario';
import type { ScenarioSnapshot } from '../scenario';
import type {
  RecordingOptions,
  Snapshot,
  SnapshotFrame,
  SnapshotLayerCodec,
} from './types';

const DEFAULT_KEYFRAME_EVERY = 120;

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Keep recorded wire semantics intact while making JSON project saves lossless. */
function cloneRecordedMessage<T extends SimulatorToRendererMessage | RendererToSimulatorMessage>(message: T): T {
  const next = clone(message);
  if (next.type === 'asset_data') {
    const payload = next.payload as { data?: unknown; mime: string };
    if (payload.data instanceof Uint8Array) payload.data = encodeBytesAsDataUrl(payload.data, payload.mime);
  }
  if (next.type === 'screenshot_response') {
    const payload = next.payload as { data?: unknown; mime?: string };
    if (payload.data instanceof Uint8Array) payload.data = encodeBytesAsDataUrl(payload.data, payload.mime ?? 'application/octet-stream');
  }
  return next;
}

function now(): number {
  return Date.now();
}

function createId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `snapshot-${crypto.randomUUID()}`
    : `snapshot-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function byteLength(value: unknown): number {
  const seen = new WeakSet<object>();
  const text = JSON.stringify(value, (_key, current) => {
    if (current instanceof Uint8Array) return { $bytes: current.byteLength };
    if (typeof current === 'object' && current !== null) {
      if (seen.has(current)) return '[circular]';
      seen.add(current);
    }
    return current;
  });
  return new TextEncoder().encode(text ?? '').byteLength;
}

function itemKey(item: Record<string, unknown>): string {
  if ('id' in item) return `id:${String(item.id)}`;
  if ('source' in item && 'target' in item) return `edge:${String(item.source)}\u0000${String(item.target)}`;
  return `item:${JSON.stringify(item, Object.keys(item).sort())}`;
}

function layerKey(payload: { env_id: string; layer_id: string }): string {
  return `${payload.env_id}\u0000${payload.layer_id}`;
}

type ItemChange = {
  kind: 'create' | 'update' | 'delete';
  payload: { env_id: string; layer_id: string };
  item: Record<string, unknown> | string | number;
  order: number;
};

/**
 * Coalesce mutations that happen before an observable frame boundary. The
 * resulting messages remain valid protocol messages and replay to the same
 * final Scenario state, while slider drags and repeated item patches do not
 * inflate recordings.
 */
function coalesceMessages(messages: SimulatorToRendererMessage[]): SimulatorToRendererMessage[] {
  const passthrough: Array<{ order: number; message: SimulatorToRendererMessage }> = [];
  const latestMetadata: Record<string, unknown> = {};
  let metadataOrder: number | undefined;
  const latestParamSync = new Map<string, { order: number; message: SimulatorToRendererMessage }>();
  const itemChanges = new Map<string, ItemChange>();

  messages.forEach((message, order) => {
    if (message.type === 'metadata_update') {
      Object.assign(latestMetadata, message.payload as Record<string, unknown>);
      metadataOrder ??= order;
      return;
    }
    if (message.type === 'param_sync') {
      const payload = message.payload as { id: string };
      latestParamSync.set(payload.id, { order, message: clone(message) });
      return;
    }
    if (message.type === 'item_create' || message.type === 'item_update' || message.type === 'item_delete') {
      const payload = message.payload as {
        env_id: string;
        layer_id: string;
        items: Array<Record<string, unknown> | string | number>;
      };
      for (const entry of payload.items) {
        const key = `${layerKey(payload)}\u0000${typeof entry === 'object' && entry !== null ? itemKey(entry) : `id:${String(entry)}`}`;
        const previous = itemChanges.get(key);
        if (message.type === 'item_create') {
          const next = clone(entry as Record<string, unknown>);
          if (previous?.kind === 'delete' || !previous) {
            itemChanges.set(key, { kind: 'create', payload, item: next, order });
          } else {
            itemChanges.set(key, {
              kind: previous.kind === 'create' ? 'create' : 'update',
              payload,
              item: { ...(previous.item as Record<string, unknown>), ...next },
              order: previous.order,
            });
          }
        } else if (message.type === 'item_update') {
          const next = clone(entry as Record<string, unknown>);
          if (!previous) {
            itemChanges.set(key, { kind: 'update', payload, item: next, order });
          } else if (previous.kind !== 'delete') {
            itemChanges.set(key, {
              ...previous,
              item: { ...(previous.item as Record<string, unknown>), ...next },
            });
          }
        } else if (previous?.kind === 'create') {
          itemChanges.delete(key);
        } else {
          itemChanges.set(key, { kind: 'delete', payload, item: clone(entry), order });
        }
      }
      return;
    }
    passthrough.push({ order, message: clone(message) });
  });

  if (metadataOrder !== undefined) {
    passthrough.push({
      order: metadataOrder,
      message: { type: 'metadata_update', payload: latestMetadata } as SimulatorToRendererMessage,
    });
  }
  passthrough.push(...latestParamSync.values());

  const grouped = new Map<string, { order: number; type: 'item_create' | 'item_update' | 'item_delete'; payload: { env_id: string; layer_id: string; items: unknown[] } }>();
  for (const change of itemChanges.values()) {
    const type = `item_${change.kind}` as 'item_create' | 'item_update' | 'item_delete';
    const key = `${type}\u0000${layerKey(change.payload)}`;
    const group = grouped.get(key) ?? {
      order: change.order,
      type,
      payload: { ...change.payload, items: [] },
    };
    group.order = Math.min(group.order, change.order);
    group.payload.items.push(change.item);
    grouped.set(key, group);
  }
  for (const group of grouped.values()) {
    passthrough.push({
      order: group.order,
      message: { type: group.type, payload: group.payload } as SimulatorToRendererMessage,
    });
  }

  return passthrough.sort((a, b) => a.order - b.order).map(({ message }) => message);
}

function coalesceControls(controls: RendererToSimulatorMessage[]): RendererToSimulatorMessage[] {
  const result: RendererToSimulatorMessage[] = [];
  const paramPositions = new Map<string, number>();
  for (const control of controls) {
    const next = cloneRecordedMessage(control);
    if (next.type === 'param_change') {
      const id = (next.payload as { id: string }).id;
      const previous = paramPositions.get(id);
      if (previous !== undefined) result[previous] = next;
      else {
        paramPositions.set(id, result.length);
        result.push(next);
      }
    } else {
      result.push(next);
    }
  }
  return result;
}

function isAppendOnlyStreamMessage(message: SimulatorToRendererMessage): boolean {
  return message.type === 'chart_create'
    || message.type === 'chart_update'
    || message.type === 'chart_delete'
    || message.type === 'asset_meta'
    || message.type === 'asset_data'
    || message.type === 'asset_delete'
    || message.type === 'log'
    || message.type === 'error';
}

/** Rehydrate streams that were intentionally omitted from a compact keyframe. */
function loadKeyframe(scenario: Scenario, snapshot: Snapshot, keyframe: Snapshot['initial']): void {
  if (keyframe === snapshot.initial) {
    scenario.load(keyframe.scenario);
    return;
  }

  const baseline = snapshot.initial.scenario;
  scenario.load({
    ...keyframe.scenario,
    charts: baseline.charts,
    logs: baseline.logs,
    assets: baseline.assets,
  });
  for (const frame of snapshot.frames) {
    if (frame.index <= snapshot.initial.frame || frame.index > keyframe.frame) continue;
    for (const message of frame.messages) {
      if (isAppendOnlyStreamMessage(message)) scenario.apply(message);
    }
  }
}

export function createSingleSnapshot(
  scenario: ScenarioSnapshot,
  options: Pick<RecordingOptions, 'id' | 'label' | 'timestamp'> = {},
): Snapshot {
  const timestamp = options.timestamp ?? now();
  return {
    version: 1,
    metadata: { id: options.id ?? createId(), createdAt: timestamp, endedAt: timestamp, label: options.label },
    initial: { frame: 0, timestamp, scenario: clone(scenario) },
    keyframes: [],
    frames: [],
    layerCodecs: {},
    byteLength: byteLength(scenario),
    truncated: false,
  };
}

/** Host-neutral recorder fed by RendererSession's existing protocol events. */
export class SnapshotRecorder {
  private snapshot: Snapshot | null = null;
  /** Frame ids identify points on the recording timeline, not array slots. */
  private nextFrameIndex = 1;
  private pendingMessages: SimulatorToRendererMessage[] = [];
  private pendingControls: RendererToSimulatorMessage[] = [];
  private flushQueued = false;
  private awaitingActionEnd = false;
  private retentionExhausted = false;
  /** Incremental accounting keeps recording work constant per frame. */
  private estimatedByteLength = 0;
  private initialByteLength = 0;
  private bytesSinceKeyframe = 0;
  private readonly frameByteLengths = new Map<number, number>();
  private readonly keyframeByteLengths = new Map<number, number>();
  private readonly keyframeScenarioByteLengths = new Map<number, number>();
  private options: Required<Pick<RecordingOptions, 'keyframeEvery' | 'ringBuffer'>> & RecordingOptions = {
    keyframeEvery: DEFAULT_KEYFRAME_EVERY,
    ringBuffer: false,
  };

  constructor(private readonly scenario: Scenario) {}

  get active(): boolean {
    return this.snapshot !== null;
  }

  get current(): Snapshot | null {
    return this.snapshot ? clone(this.snapshot) : null;
  }

  start(options: RecordingOptions = {}): Snapshot {
    this.stop();
    if (options.maxBytes !== undefined && (!Number.isFinite(options.maxBytes) || options.maxBytes < 1)) {
      throw new Error('RecordingOptions.maxBytes must be a positive finite number.');
    }
    const timestamp = options.timestamp ?? now();
    this.options = {
      ...options,
      keyframeEvery: options.keyframeEvery ?? DEFAULT_KEYFRAME_EVERY,
      ringBuffer: options.ringBuffer === true,
    };
    this.snapshot = createSingleSnapshot(this.scenario.dump(), {
      id: options.id,
      label: options.label,
      timestamp,
    });
    this.nextFrameIndex = this.snapshot.initial.frame + 1;
    this.snapshot.metadata.endedAt = undefined;
    this.snapshot.layerCodecs = clone(options.layerCodecs ?? {});
    this.frameByteLengths.clear();
    this.keyframeByteLengths.clear();
    this.keyframeScenarioByteLengths.clear();
    this.initialByteLength = byteLength(this.snapshot.initial);
    this.keyframeScenarioByteLengths.set(this.snapshot.initial.frame, byteLength(this.snapshot.initial.scenario));
    this.estimatedByteLength = this.initialByteLength + byteLength({
      version: this.snapshot.version,
      metadata: this.snapshot.metadata,
      layerCodecs: this.snapshot.layerCodecs,
    });
    this.snapshot.byteLength = this.estimatedByteLength;
    this.bytesSinceKeyframe = 0;
    this.awaitingActionEnd = false;
    this.retentionExhausted = false;
    if (this.options.maxBytes !== undefined && this.estimatedByteLength > this.options.maxBytes) {
      const baseline = this.estimatedByteLength;
      this.snapshot = null;
      this.frameByteLengths.clear();
      this.keyframeByteLengths.clear();
      this.keyframeScenarioByteLengths.clear();
      this.estimatedByteLength = 0;
      this.initialByteLength = 0;
      throw new Error(
        `RecordingOptions.maxBytes (${this.options.maxBytes}) is smaller than the initial snapshot baseline (${baseline}).`,
      );
    }
    return clone(this.snapshot);
  }

  stop(): Snapshot | null {
    if (!this.snapshot) return null;
    this.flush('control');
    this.snapshot.metadata.endedAt = now();
    this.snapshot.byteLength = this.estimatedByteLength;
    const complete = clone(this.snapshot);
    this.snapshot = null;
    this.nextFrameIndex = 1;
    this.pendingMessages = [];
    this.pendingControls = [];
    this.flushQueued = false;
    this.awaitingActionEnd = false;
    this.retentionExhausted = false;
    this.estimatedByteLength = 0;
    this.initialByteLength = 0;
    this.bytesSinceKeyframe = 0;
    this.frameByteLengths.clear();
    this.keyframeByteLengths.clear();
    this.keyframeScenarioByteLengths.clear();
    return complete;
  }

  recordMessage(message: SimulatorToRendererMessage): void {
    if (!this.snapshot || this.retentionExhausted) return;
    this.pendingMessages.push(cloneRecordedMessage(message));
    if (message.type === 'action_end') {
      this.flush('action', message.payload as ActionEndPayload);
      this.awaitingActionEnd = false;
    } else if (message.type === 'state_sync_end') {
      this.flush('sync');
    } else if (!this.awaitingActionEnd) {
      this.queueControlFlush();
    }
  }

  recordControl(message: RendererToSimulatorMessage): void {
    if (!this.snapshot || this.retentionExhausted) return;
    this.pendingControls.push(cloneRecordedMessage(message));
    if (message.type === 'action_start') {
      this.awaitingActionEnd = true;
    } else if (!this.awaitingActionEnd) {
      this.queueControlFlush();
    }
  }

  private queueControlFlush(): void {
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      this.flush('control');
    });
  }

  private flush(kind: SnapshotFrame['kind'], action?: ActionEndPayload): void {
    const target = this.snapshot;
    if (!target || (!this.pendingMessages.length && !this.pendingControls.length)) return;
    const timestamp = now();
    let forceKeyframe = false;
    const messages = coalesceMessages(this.pendingMessages).filter((message) => {
      if (message.type !== 'item_create' && message.type !== 'item_update' && message.type !== 'item_delete') return true;
      const payload = message.payload as { env_id: string; layer_id: string };
      const codec = this.resolveLayerCodec(payload);
      if (codec === 'keyframe') {
        forceKeyframe = true;
        return false;
      }
      // Derived layers are reconstructed by their storage/parent layer and do
      // not own independent item deltas in a recording.
      return codec !== 'derived';
    });
    const frame: SnapshotFrame = {
      index: this.nextFrameIndex++,
      timestamp,
      messages,
      controls: coalesceControls(this.pendingControls),
      action: action ? clone(action) : undefined,
      kind,
    };
    target.frames.push(frame);
    const frameByteLength = byteLength(frame);
    this.frameByteLengths.set(frame.index, frameByteLength);
    this.estimatedByteLength += frameByteLength;
    this.bytesSinceKeyframe += frameByteLength;
    this.pendingMessages = [];
    this.pendingControls = [];

    const previousKeyframe = target.keyframes[target.keyframes.length - 1] ?? target.initial;
    const adaptiveThreshold = Math.max(
      (this.keyframeScenarioByteLengths.get(previousKeyframe.frame) ?? 0) / 3,
      64 * 1024,
    );
    const sinceKeyframe = frame.index - previousKeyframe.frame;
    if (
      forceKeyframe
      || sinceKeyframe >= this.options.keyframeEvery
      || this.bytesSinceKeyframe >= adaptiveThreshold
    ) {
      const keyframe = {
        frame: frame.index,
        timestamp,
        scenario: this.scenario.dump({
          includeCharts: false,
          includeLogs: false,
          includeAssets: false,
        }),
      };
      target.keyframes.push(keyframe);
      const keyframeByteLength = byteLength(keyframe);
      this.keyframeByteLengths.set(keyframe.frame, keyframeByteLength);
      this.keyframeScenarioByteLengths.set(keyframe.frame, byteLength(keyframe.scenario));
      this.estimatedByteLength += keyframeByteLength;
      this.bytesSinceKeyframe = 0;
    }
    this.enforceRetention();
    target.byteLength = this.estimatedByteLength;
  }

  private resolveLayerCodec(payload: { env_id: string; layer_id: string }): SnapshotLayerCodec {
    const layer = this.scenario.getEnvironment(payload.env_id)?.layers.get(payload.layer_id);
    return this.options.layerCodecs?.[`${payload.env_id}/${payload.layer_id}`]
      ?? this.options.layerCodecs?.[payload.layer_id]
      ?? (layer ? this.options.layerCodecs?.[layer.layerType] : undefined)
      ?? 'adaptive';
  }

  private enforceRetention(): void {
    const target = this.snapshot;
    if (!target) return;
    const exceedsBytes = (): boolean => (
      this.options.maxBytes !== undefined && this.estimatedByteLength > this.options.maxBytes
    );
    const exceeds = (): boolean => {
      const frames = target.frames;
      const first = frames[0];
      return (this.options.maxSteps !== undefined && frames.length > this.options.maxSteps)
        || (this.options.maxDurationMs !== undefined && first !== undefined && now() - first.timestamp > this.options.maxDurationMs)
        || exceedsBytes();
    };
    if (!exceeds()) return;
    if (!this.options.ringBuffer) {
      if (exceedsBytes()) this.discardNewestFrame();
      target.truncated = true;
      this.retentionExhausted = true;
      return;
    }

    while (target.frames.length > 1 && exceeds()) {
      const removed = target.frames[0];
      const state = materializeSnapshot(target, removed.index);
      target.frames.shift();
      this.estimatedByteLength -= this.frameByteLengths.get(removed.index) ?? 0;
      this.frameByteLengths.delete(removed.index);
      const nextInitial = { frame: removed.index, timestamp: removed.timestamp, scenario: state };
      const nextInitialByteLength = byteLength(nextInitial);
      this.estimatedByteLength += nextInitialByteLength - this.initialByteLength;
      this.initialByteLength = nextInitialByteLength;
      this.keyframeScenarioByteLengths.delete(target.initial.frame);
      this.keyframeScenarioByteLengths.set(nextInitial.frame, byteLength(state));
      target.initial = nextInitial;
      for (const keyframe of target.keyframes) {
        if (keyframe.frame > removed.index) continue;
        this.estimatedByteLength -= this.keyframeByteLengths.get(keyframe.frame) ?? 0;
        this.keyframeByteLengths.delete(keyframe.frame);
        this.keyframeScenarioByteLengths.delete(keyframe.frame);
      }
      target.keyframes = target.keyframes.filter((keyframe) => keyframe.frame > removed.index);
      this.bytesSinceKeyframe = 0;
      target.truncated = true;
    }

    // A single encoded frame can be larger than the remaining budget. It has
    // no seekable suffix to retain, so discard it rather than publishing a
    // snapshot that claims a strict byte budget while exceeding it.
    if (exceedsBytes()) {
      this.discardNewestFrame();
      target.truncated = true;
      this.retentionExhausted = true;
    } else if (exceeds()) {
      target.truncated = true;
      this.retentionExhausted = true;
    }
  }

  /** Drop an unretainable tail frame and rebuild accounting from retained segments. */
  private discardNewestFrame(): void {
    const target = this.snapshot;
    const removed = target?.frames.pop();
    if (!target || !removed) return;

    const lastFrame = target.frames[target.frames.length - 1]?.index ?? target.initial.frame;
    target.keyframes = target.keyframes.filter((keyframe) => keyframe.frame <= lastFrame);
    this.frameByteLengths.clear();
    this.keyframeByteLengths.clear();
    this.keyframeScenarioByteLengths.clear();
    this.initialByteLength = byteLength(target.initial);
    this.keyframeScenarioByteLengths.set(target.initial.frame, byteLength(target.initial.scenario));
    this.estimatedByteLength = this.initialByteLength + byteLength({
      version: target.version,
      metadata: target.metadata,
      layerCodecs: target.layerCodecs,
    });
    for (const frame of target.frames) {
      const length = byteLength(frame);
      this.frameByteLengths.set(frame.index, length);
      this.estimatedByteLength += length;
    }
    for (const keyframe of target.keyframes) {
      const length = byteLength(keyframe);
      this.keyframeByteLengths.set(keyframe.frame, length);
      this.keyframeScenarioByteLengths.set(keyframe.frame, byteLength(keyframe.scenario));
      this.estimatedByteLength += length;
    }
    const previousKeyframe = target.keyframes[target.keyframes.length - 1] ?? target.initial;
    this.bytesSinceKeyframe = target.frames
      .filter((frame) => frame.index > previousKeyframe.frame)
      .reduce((total, frame) => total + (this.frameByteLengths.get(frame.index) ?? 0), 0);
  }
}

/** Reconstruct a Scenario state at any retained frame without a live simulator. */
export function materializeSnapshot(snapshot: Snapshot, frame = snapshot.frames[snapshot.frames.length - 1]?.index ?? snapshot.initial.frame): ScenarioSnapshot {
  const lastFrame = snapshot.frames[snapshot.frames.length - 1]?.index ?? snapshot.initial.frame;
  const bounded = Math.max(snapshot.initial.frame, Math.min(frame, lastFrame));
  const keyframe = [...snapshot.keyframes, snapshot.initial]
    .filter((candidate) => candidate.frame <= bounded)
    .sort((a, b) => b.frame - a.frame)[0];
  const scenario = new Scenario();
  loadKeyframe(scenario, snapshot, keyframe);
  for (const recordedFrame of snapshot.frames) {
    if (recordedFrame.index <= keyframe.frame || recordedFrame.index > bounded) continue;
    for (const message of recordedFrame.messages) scenario.apply(clone(message));
  }
  return scenario.dump();
}

export function snapshotFrameAt(snapshot: Snapshot, frame: number): SnapshotFrame | undefined {
  return snapshot.frames.find((candidate) => candidate.index === frame);
}

/**
 * Stateful replay cursor. Forward playback applies only the next delta frame;
 * a full keyframe load is reserved for random/backward seeks.
 */
export class SnapshotPlayer {
  readonly scenario = new Scenario();
  private currentFrame: number;

  constructor(readonly snapshot: Snapshot) {
    this.currentFrame = snapshot.initial.frame;
    loadKeyframe(this.scenario, snapshot, snapshot.initial);
  }

  get frame(): number {
    return this.currentFrame;
  }

  seek(frame: number): Scenario {
    const lastFrame = this.snapshot.frames[this.snapshot.frames.length - 1]?.index ?? this.snapshot.initial.frame;
    const target = Math.max(this.snapshot.initial.frame, Math.min(frame, lastFrame));
    if (target === this.currentFrame) return this.scenario;

    if (target < this.currentFrame) {
      const keyframe = [...this.snapshot.keyframes, this.snapshot.initial]
        .filter((candidate) => candidate.frame <= target)
        .sort((a, b) => b.frame - a.frame)[0];
      loadKeyframe(this.scenario, this.snapshot, keyframe);
      this.currentFrame = keyframe.frame;
    }

    for (const recordedFrame of this.snapshot.frames) {
      if (recordedFrame.index <= this.currentFrame || recordedFrame.index > target) continue;
      for (const message of recordedFrame.messages) this.scenario.apply(message);
      this.currentFrame = recordedFrame.index;
    }
    return this.scenario;
  }
}

export type { Keyframe, RecordingOptions, Snapshot, SnapshotFrame, SnapshotLayerCodec } from './types';
