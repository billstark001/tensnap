import { ChartGroup, ChartMetadata, ChartSeriesPoint, ChartUpdateData } from "./types";
import { instantiateChartMetadata } from "./utils";

type WarnFn = (msg: string) => void;

// #region Utilities

function mapGetOrInit<K, V>(map: Map<K, V[]>, key: K): V[] {
  let list = map.get(key);
  if (!list) map.set(key, (list = []));
  return list;
}

function mapListRemove<K, V>(map: Map<K, V[]>, key: K, item: V): void {
  const list = map.get(key);
  if (!list) return;
  const next = list.filter(x => x !== item);
  next.length ? map.set(key, next) : map.delete(key);
}

/**
 * Returns the index of the element in `data` (sorted ascending by `time`)
 * whose time is closest to `time`.
 */
function closestTimeIndex(data: ChartSeriesPoint[], time: number): number {
  let lo = 0, hi = data.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (data[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && time - data[lo - 1].time <= data[lo].time - time) return lo - 1;
  return lo;
}

// #endregion



// #region ChartStorage

export class ChartStorage {
  /** All registered chart groups, keyed by group ID. */
  private readonly groups = new Map<string, ChartGroup>();

  /** All metadata instances per metadata ID (multiple groups may share an ID). */
  private readonly metaMap = new Map<string, ChartMetadata[]>();

  /** Groups containing a given metadata ID. */
  private readonly metaGroups = new Map<string, ChartGroup[]>();

  /** Per-group point buffers used during push(). */
  private readonly pushBuffer = new Map<string, Map<number, ChartSeriesPoint>>();

  constructor(groups: ChartGroup[] = []) {
    for (const g of groups) this.addGroup(g);
  }

  // #region Snapshot 

  shallowCopy(): ChartStorage {
    const copy = new ChartStorage();
    this.groups.forEach((g, id) => { copy.groups.set(id, g); copy.pushBuffer.set(id, new Map()); });
    this.metaMap.forEach((list, id) => copy.metaMap.set(id, list));
    this.metaGroups.forEach((list, id) => copy.metaGroups.set(id, list));
    return copy;
  }

  dump(): ChartGroup[] {
    return this.getGroupList().map((group) => ({
      id: group.id,
      label: group.label,
      metadataDict: Object.fromEntries(
        Object.entries(group.metadataDict).map(([id, meta]) => [id, { ...meta }])
      ),
      data: group.data.map((point) => ({ ...point })),
    }));
  }

  load(snapshot: ChartGroup[]): void {
    this.groups.clear();
    this.metaMap.clear();
    this.metaGroups.clear();
    this.pushBuffer.clear();
    for (const group of snapshot) {
      this.addGroup({
        id: group.id,
        label: group.label,
        metadataDict: Object.fromEntries(
          Object.entries(group.metadataDict).map(([id, meta]) => [id, { ...meta }])
        ),
        data: group.data.map((point) => ({ ...point })),
      });
    }
  }

  // #endregion
  // #region Internal: registration 

  private _register(metaId: string, meta: ChartMetadata, group: ChartGroup): void {
    mapGetOrInit(this.metaMap, metaId).push(meta);
    mapGetOrInit(this.metaGroups, metaId).push(group);
  }

  private _unregister(metaId: string, group: ChartGroup): void {
    // Must be called before the metadataDict entry is deleted.
    mapListRemove(this.metaMap, metaId, group.metadataDict[metaId]);
    mapListRemove(this.metaGroups, metaId, group);
  }

  /**
   * Detach a metadata ID from a group, cleaning up data entries and map
   * registrations. Removes the group entirely if it becomes empty.
   */
  private _detachMeta(metaId: string, group: ChartGroup, persistData: boolean): void {
    if (!persistData) {
      for (const dp of group.data) delete dp[metaId];
    }
    this._unregister(metaId, group); // must precede metadataDict deletion
    delete group.metadataDict[metaId];

    if (!Object.keys(group.metadataDict).length) {
      this.groups.delete(group.id);
      this.pushBuffer.delete(group.id);
    }
  }

  // #endregion
  // #region Internal: data helpers 

  private _extractPoints(data: ChartSeriesPoint[], metaId: string): ChartSeriesPoint[] {
    return data
      .filter(dp => dp[metaId] !== undefined)
      .map(dp => ({ time: dp.time, [metaId]: dp[metaId] }));
  }

  private _mergePoints(groups: ChartGroup[], metaId: string): ChartSeriesPoint[] {
    const byTime = new Map<number, any>();
    for (const { data } of groups) {
      for (const dp of data) {
        if (dp[metaId] !== undefined) byTime.set(dp.time, dp[metaId]);
      }
    }
    return [...byTime.entries()]
      .sort(([a], [b]) => a - b)
      .map(([time, value]) => ({ time, [metaId]: value }));
  }

  /** Insert new points into a group's sorted data array in-place. */
  private _appendToGroup(group: ChartGroup, incoming: ChartSeriesPoint[]): void {
    if (!incoming.length) return;

    if (!group.data.length) {
      group.data = incoming.length > 1 ? incoming.sort((a, b) => a.time - b.time) : [...incoming];
      return;
    }

    const lastTime = group.data[group.data.length - 1].time;
    if (incoming.every(p => p.time >= lastTime)) {
      if (incoming.length > 1) incoming.sort((a, b) => a.time - b.time);
      group.data.push(...incoming);
    } else {
      group.data.push(...incoming);
      group.data.sort((a, b) => a.time - b.time);
    }
  }

  // #endregion
  // #region Groups 

  hasGroup(groupId: string): boolean {
    return this.groups.has(groupId);
  }

  getGroup(groupId: string): ChartGroup | undefined {
    return this.groups.get(groupId);
  }

  addGroup(group: ChartGroup, upsert = false): void {
    const existing = this.groups.get(group.id);

    if (upsert && existing) {
      existing.label = group.label;
      for (const [id, meta] of Object.entries(group.metadataDict)) {
        if (!(id in existing.metadataDict)) {
          existing.metadataDict[id] = meta;
          this._register(id, meta, existing);
        }
      }
      existing.data.push(...group.data);
    } else {
      this.groups.set(group.id, group);
      this.pushBuffer.set(group.id, new Map());
      for (const [id, meta] of Object.entries(group.metadataDict)) {
        this._register(id, meta, group);
      }
    }
  }

  removeGroup(groupId: string): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;

    for (const metaId of Object.keys(group.metadataDict)) this._unregister(metaId, group);
    this.groups.delete(groupId);
    this.pushBuffer.delete(groupId);
    return true;
  }

  renameGroup(oldId: string, newId: string, warn: WarnFn = console.warn): boolean {
    const group = this.groups.get(oldId);
    if (!group) return false;
    if (this.groups.has(newId)) { warn(`Group "${newId}" already exists.`); return false; }

    group.id = newId;
    this.groups.delete(oldId);
    this.groups.set(newId, group);

    // metaGroups stores group references directly, so no update needed there.
    const buf = this.pushBuffer.get(oldId) ?? new Map<number, ChartSeriesPoint>();
    this.pushBuffer.delete(oldId);
    this.pushBuffer.set(newId, buf);
    return true;
  }

  getGroupList(): ChartGroup[] {
    return [...this.groups.values()];
  }

  // #endregion
  // #region Metadata 

  upsertMeta(meta: ChartMetadata): void {
    const existing = this.metaMap.get(meta.id);
    if (existing?.length) {
      existing.forEach(m => Object.assign(m, meta));
    } else {
      this.addGroup(instantiateChartMetadata(meta));
    }
  }

  addMeta(groupId: string, meta: ChartMetadata, warn: WarnFn = console.warn): boolean {
    const group = this.groups.get(groupId);
    if (!group) { warn(`Group "${groupId}" not found.`); return false; }
    if (meta.id in group.metadataDict) {
      warn(`Metadata "${meta.id}" already exists in group "${groupId}".`);
      return false;
    }
    group.metadataDict[meta.id] = meta;
    this._register(meta.id, meta, group);
    return true;
  }

  updateMeta(metaId: string, update: Partial<ChartMetadata>): boolean {
    const list = this.metaMap.get(metaId);
    if (!list?.length) return false;
    list.forEach(m => Object.assign(m, update));
    return true;
  }

  /**
   * Remove a metadata ID from all groups.
   * @returns The merged data points if `returnData` is true; an empty array on
   *   success if false; `null` if the metadata was not found.
   */
  removeMeta(
    metaId: string,
    opts?: { persistData?: boolean; returnData?: boolean }
  ): ChartSeriesPoint[] | null {
    const groups = this.metaGroups.get(metaId);
    if (!groups?.length) return null;

    const { persistData = false, returnData = false } = opts ?? {};
    const result = returnData ? this._mergePoints([...groups], metaId) : [];

    for (const group of [...groups]) this._detachMeta(metaId, group, persistData);
    return returnData ? result : [];
  }

  /**
   * Remove a metadata ID from a specific group.
   * @returns Extracted data points if `returnData` is true; `null` on failure
   *   or when `returnData` is false.
   */
  removeMetaFromGroup(
    metaId: string,
    groupId: string,
    opts?: { persistData?: boolean; returnData?: boolean },
    warn: WarnFn = console.warn
  ): ChartSeriesPoint[] | null {
    const group = this.groups.get(groupId);
    if (!group) { warn(`Group "${groupId}" not found.`); return null; }
    if (!(metaId in group.metadataDict)) {
      warn(`Metadata "${metaId}" not found in group "${groupId}".`);
      return null;
    }

    const { persistData = false, returnData = false } = opts ?? {};
    const result = returnData ? this._extractPoints(group.data, metaId) : null;
    this._detachMeta(metaId, group, persistData);
    return result;
  }

  /**
   * Move (or copy) a metadata ID from one group to another.
   * When `copy` is true the source metadata is kept in its original group and a
   * shallow clone is registered in the target group.
   */
  moveMeta(
    metaId: string,
    fromGroupId: string,
    toGroupId: string,
    opts?: { copy?: boolean },
    warn: WarnFn = console.warn
  ): boolean {
    const from = this.groups.get(fromGroupId);
    const to = this.groups.get(toGroupId);
    if (!from) { warn(`Group "${fromGroupId}" not found.`); return false; }
    if (!to) { warn(`Group "${toGroupId}" not found.`); return false; }
    if (!(metaId in from.metadataDict)) {
      warn(`Metadata "${metaId}" not found in group "${fromGroupId}".`);
      return false;
    }

    const { copy = false } = opts ?? {};
    // Clone metadata when copying so each group owns an independent object.
    const targetMeta = copy ? { ...from.metadataDict[metaId] } : from.metadataDict[metaId];
    const points = this._extractPoints(from.data, metaId);

    if (!copy) this._detachMeta(metaId, from, false);

    if (!(metaId in to.metadataDict)) {
      to.metadataDict[metaId] = targetMeta;
      this._register(metaId, targetMeta, to);
    }

    if (points.length) this.pushMany(metaId, points);
    return true;
  }

  renameMeta(
    oldId: string,
    newId: string,
    groupId?: string,
    warn: WarnFn = console.warn
  ): boolean {
    if (this.metaMap.has(newId)) { warn(`Metadata "${newId}" already exists.`); return false; }

    const candidates = groupId
      ? (this.groups.get(groupId) ? [this.groups.get(groupId)!] : [])
      : [...(this.metaGroups.get(oldId) ?? [])];

    const affected = candidates.filter(g => oldId in g.metadataDict);
    if (!affected.length) return false;

    for (const group of affected) {
      const meta = group.metadataDict[oldId];
      meta.id = newId;
      group.metadataDict[newId] = meta;
      delete group.metadataDict[oldId];
      for (const dp of group.data) {
        if (oldId in dp) { dp[newId] = dp[oldId]; delete dp[oldId]; }
      }
    }

    const metaList = this.metaMap.get(oldId);
    if (metaList) { this.metaMap.delete(oldId); this.metaMap.set(newId, metaList); }

    const groupList = this.metaGroups.get(oldId);
    if (groupList) { this.metaGroups.delete(oldId); this.metaGroups.set(newId, groupList); }

    return true;
  }

  getMetaIds(): string[] {
    return [...this.metaMap.keys()];
  }

  /** Returns all groups that contain the given metadata ID. */
  getGroupsForMeta(metaId: string): ChartGroup[] {
    return this.metaGroups.get(metaId) ?? [];
  }

  getAllMeta(): ChartMetadata[] {
    const seen = new Set<string>();
    const result: ChartMetadata[] = [];
    this.metaMap.forEach(list => {
      for (const m of list) {
        if (!seen.has(m.id)) { result.push(m); seen.add(m.id); }
      }
    });
    return result;
  }

  // #endregion
  // #region Queries 

  /**
   * Returns all data points for a metadata ID merged across groups, sorted by
   * time. Returns `null` if the metadata does not exist.
   */
  getData(metaId: string): ChartSeriesPoint[] | null {
    const groups = this.metaGroups.get(metaId);
    if (!groups?.length) return null;
    const result = this._mergePoints(groups, metaId);
    return result.length ? result : null;
  }

  /** Returns the value at the time point closest to `time`, or `undefined`. */
  getValueAt(metaId: string, time: number): number | undefined {
    const groups = this.metaGroups.get(metaId);
    if (!groups?.length) return undefined;

    let best: number | undefined;
    let bestDiff = Infinity;

    for (const { data } of groups) {
      if (!data.length) continue;
      const idx = closestTimeIndex(data, time);
      const value = data[idx][metaId];
      if (value !== undefined) {
        const diff = Math.abs(data[idx].time - time);
        if (diff < bestDiff) { bestDiff = diff; best = value; }
      }
    }

    return best;
  }

  // #endregion
  // #region Data mutation 

  push(currentTime: number, points: ChartUpdateData[], warn: WarnFn = console.warn): void {
    this.pushBuffer.forEach(m => m.clear());

    for (const { id, time = currentTime, value } of points) {
      const groups = this.metaGroups.get(id);
      if (!groups) { warn(`Metadata "${id}" not found.`); continue; }

      for (const group of groups) {
        const buf = this.pushBuffer.get(group.id)!;
        const dp = buf.get(time) ?? { time };
        dp[id] = value;
        buf.set(time, dp);
      }
    }

    this.pushBuffer.forEach((buf, groupId) => {
      if (!buf.size) return;
      this._appendToGroup(this.groups.get(groupId)!, [...buf.values()]);
    });
  }

  pushMany(metaId: string, points: ChartSeriesPoint[], warn: WarnFn = console.warn): void {
    if (!points.length) return;
    const groups = this.metaGroups.get(metaId);
    if (!groups?.length) { warn(`Metadata "${metaId}" not found.`); return; }

    const sorted = [...points].sort((a, b) => a.time - b.time);

    for (const group of groups) {
      const index = new Map<number, ChartSeriesPoint>(
        group.data.map(dp => [dp.time, { ...dp }])
      );
      for (const dp of sorted) {
        if (!(metaId in dp)) continue;
        const existing = index.get(dp.time);
        if (existing) existing[metaId] = dp[metaId];
        else index.set(dp.time, { time: dp.time, [metaId]: dp[metaId] });
      }
      group.data = [...index.values()].sort((a, b) => a.time - b.time);
    }
  }

  clearAll(): void {
    this.groups.forEach(g => { g.data = []; });
  }

  clearGroups(groupIds: string[]): Set<string> {
    const cleared = new Set<string>();
    for (const id of groupIds) {
      const group = this.groups.get(id);
      if (group) { group.data = []; cleared.add(id); }
    }
    return cleared;
  }

  clearMetas(metaIds: string[]): Set<string> {
    const byGroup = new Map<string, Set<string>>();
    const cleared = new Set<string>();

    for (const metaId of metaIds) {
      const groups = this.metaGroups.get(metaId);
      if (!groups?.length) continue;
      cleared.add(metaId);
      for (const g of groups) {
        const set = byGroup.get(g.id) ?? new Set<string>();
        set.add(metaId);
        byGroup.set(g.id, set);
      }
    }

    byGroup.forEach((metas, groupId) => {
      const group = this.groups.get(groupId);
      if (!group) return;
      if (metas.size === Object.keys(group.metadataDict).length) {
        group.data = [];
      } else {
        group.data = group.data.map(dp => {
          const copy = { ...dp };
          metas.forEach(id => delete copy[id]);
          return copy;
        });
      }
    });

    return cleared;
  }

  // #endregion
}

// #endregion
