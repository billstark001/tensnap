import type { MonitorMetadata, MonitorUpdatePayload, ProtocolData } from '@tensnap/protocol';

export interface MonitorState extends MonitorMetadata {
  value?: ProtocolData;
  revision?: string | number;
}

/** Current-value monitor storage. Updates replace, never append. */
export class MonitorStorage {
  private readonly monitors = new Map<string, MonitorState>();
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

  create(metadata: MonitorMetadata): void {
    if (this.monitors.has(metadata.id)) throw new Error(`monitor_create already exists: ${metadata.id}`);
    this.monitors.set(metadata.id, structuredClone(metadata));
    this.revisionState += 1;
  }

  update(payload: MonitorUpdatePayload): void {
    const monitor = this.monitors.get(payload.id);
    if (!monitor) throw new Error(`monitor_update does not exist: ${payload.id}`);
    monitor.value = structuredClone(payload.value);
    if (payload.revision !== undefined) monitor.revision = payload.revision;
    this.revisionState += 1;
  }

  delete(id: string): boolean {
    const deleted = this.monitors.delete(id);
    if (deleted) this.revisionState += 1;
    return deleted;
  }

  clear(): void {
    if (this.monitors.size === 0) return;
    this.monitors.clear();
    this.revisionState += 1;
  }

  dump(): MonitorState[] {
    const ret = [];
    for (const monitor of this.monitors.values()) ret.push(structuredClone(monitor));
    return ret;
  }

  load(snapshot: readonly MonitorState[]): void {
    this.monitors.clear();
    for (const monitor of snapshot) this.monitors.set(monitor.id, structuredClone(monitor));
    this.revisionState += 1;
  }
}
