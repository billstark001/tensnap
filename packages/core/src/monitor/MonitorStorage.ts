import type { MonitorMetadata, MonitorUpdatePayload, ProtocolData } from '@tensnap/protocol';

export interface MonitorState extends MonitorMetadata {
  value?: ProtocolData;
  revision?: string | number;
}

export type MonitorListener = () => void;

/** Current-value monitor storage. Updates replace, never append. */
export class MonitorStorage {
  private readonly monitors = new Map<string, MonitorState>();
  private readonly revisionsById = new Map<string, number>();
  private readonly listenersById = new Map<string, Set<MonitorListener>>();
  private readonly listeners = new Set<MonitorListener>();
  private revisionState = 0;

  get revision(): number {
    return this.revisionState;
  }

  get all(): ReadonlyMap<string, MonitorState> {
    return this.monitors;
  }

  get(id: string): MonitorState | undefined {
    const value = this.monitors.get(id);
    return value === undefined ? undefined : structuredClone(value);
  }

  /**
   * Returns the immutable, storage-owned monitor snapshot without a second
   * copy. Consumers must treat this reference as read-only; every mutation
   * replaces the stored object, so previous snapshots remain stable.
   */
  getSnapshot(id: string): Readonly<MonitorState> | undefined {
    return this.monitors.get(id);
  }

  getRevision(id: string): number {
    return this.revisionsById.get(id) ?? 0;
  }

  /** Subscribe to metadata or value changes for one monitor only. */
  subscribe(id: string, listener: MonitorListener): () => void {
    const listeners = this.listenersById.get(id) ?? new Set<MonitorListener>();
    listeners.add(listener);
    this.listenersById.set(id, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listenersById.delete(id);
    };
  }

  /** Subscribe to monitor collection changes, primarily for metadata editors. */
  subscribeAll(listener: MonitorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  create(metadata: MonitorMetadata): void {
    if (this.monitors.has(metadata.id)) throw new Error(`monitor_create already exists: ${metadata.id}`);
    this.monitors.set(metadata.id, structuredClone(metadata));
    this.publish([metadata.id], true);
  }

  update(payload: MonitorUpdatePayload): void {
    const monitor = this.monitors.get(payload.id);
    if (!monitor) throw new Error(`monitor_update does not exist: ${payload.id}`);
    // Own the protocol payload exactly once. Replacing the containing object
    // keeps earlier snapshots safe for useSyncExternalStore/React.
    this.monitors.set(payload.id, {
      ...monitor,
      value: structuredClone(payload.value),
      ...(payload.revision === undefined ? {} : { revision: payload.revision }),
    });
    this.publish([payload.id], false);
  }

  delete(id: string): boolean {
    const deleted = this.monitors.delete(id);
    if (deleted) this.publish([id], true);
    return deleted;
  }

  clear(): void {
    if (this.monitors.size === 0) return;
    const ids = [...this.monitors.keys()];
    this.monitors.clear();
    this.publish(ids, true);
  }

  dump(): MonitorState[] {
    const ret = [];
    for (const monitor of this.monitors.values()) ret.push(structuredClone(monitor));
    return ret;
  }

  load(snapshot: readonly MonitorState[]): void {
    const changedIds = new Set(this.monitors.keys());
    this.monitors.clear();
    for (const monitor of snapshot) {
      this.monitors.set(monitor.id, structuredClone(monitor));
      changedIds.add(monitor.id);
    }
    if (changedIds.size > 0) this.publish(changedIds, true);
  }

  private publish(ids: Iterable<string>, collectionChanged: boolean): void {
    const changedIds = [...new Set(ids)];
    if (changedIds.length === 0) return;
    this.revisionState += 1;
    for (const id of changedIds) {
      this.revisionsById.set(id, (this.revisionsById.get(id) ?? 0) + 1);
      for (const listener of this.listenersById.get(id) ?? []) listener();
    }
    if (collectionChanged) {
      for (const listener of this.listeners) listener();
    }
  }
}
