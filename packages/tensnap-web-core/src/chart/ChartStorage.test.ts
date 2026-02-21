import { ChartStorage } from './ChartStorage';
import { ChartGroup, ChartGroupMetadata } from './types';
import { instantiateChartMetadata } from './utils';

function makeGroup(id: string, label = id, metaIds: string[] = [id]): ChartGroup {
  return {
    id,
    label,
    metadataDict: Object.fromEntries(metaIds.map(mid => [mid, { id: mid, label: mid }])),
    data: [],
  };
}
describe('instantiateChartMetadata', () => {
  it('creates a group with the metadata as the sole entry when dataList is absent', () => {
    const meta: ChartGroupMetadata = { id: 'a', label: 'A', color: '#f00' };
    const group = instantiateChartMetadata(meta);
    expect(group.id).toBe('a');
    expect(group.label).toBe('A');
    expect(group.data).toEqual([]);
    expect(group.metadataDict).toEqual({ a: meta });
  });

  it('uses dataList entries as the metadataDict when provided', () => {
    const meta: ChartGroupMetadata = {
      id: 'g',
      label: 'G',
      dataList: [
        { id: 'm1', label: 'M1' },
        { id: 'm2', label: 'M2' },
      ],
    };
    const group = instantiateChartMetadata(meta);
    expect(Object.keys(group.metadataDict)).toEqual(['m1', 'm2']);
  });
});

// ── Group CRUD ────────────────────────────────────────────────────────────────

describe('ChartStorage – group operations', () => {
  it('hasGroup returns false for unknown id', () => {
    const s = new ChartStorage();
    expect(s.hasGroup('x')).toBe(false);
  });

  it('addGroup / hasGroup / getGroupList round-trip', () => {
    const s = new ChartStorage([makeGroup('g1'), makeGroup('g2')]);
    expect(s.hasGroup('g1')).toBe(true);
    expect(s.hasGroup('g2')).toBe(true);
    expect(s.getGroupList()).toHaveLength(2);
  });

  it('addGroup with upsert merges metadata and label', () => {
    const s = new ChartStorage([makeGroup('g', 'old', ['m1'])]);
    const update = makeGroup('g', 'new', ['m2']);
    s.addGroup(update, true);
    const groups = s.getGroupList();
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('new');
    expect(Object.keys(groups[0].metadataDict)).toEqual(expect.arrayContaining(['m1', 'm2']));
  });

  it('removeGroup returns true and deletes the group', () => {
    const s = new ChartStorage([makeGroup('g1')]);
    expect(s.removeGroup('g1')).toBe(true);
    expect(s.hasGroup('g1')).toBe(false);
  });

  it('removeGroup returns false for unknown group', () => {
    const s = new ChartStorage();
    expect(s.removeGroup('nope')).toBe(false);
  });

  it('renameGroup changes the group id', () => {
    const s = new ChartStorage([makeGroup('old')]);
    expect(s.renameGroup('old', 'new')).toBe(true);
    expect(s.hasGroup('old')).toBe(false);
    expect(s.hasGroup('new')).toBe(true);
  });

  it('renameGroup rejects when target id already exists', () => {
    const s = new ChartStorage([makeGroup('a'), makeGroup('b')]);
    const warn = jest.fn();
    expect(s.renameGroup('a', 'b', warn)).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('shallowCopy shares group objects but not the pushBuffer maps', () => {
    const s = new ChartStorage([makeGroup('g')]);
    const copy = s.shallowCopy();
    expect(copy.hasGroup('g')).toBe(true);
    expect(copy.getGroupList()[0]).toBe(s.getGroupList()[0]); // same reference
  });
});

// ── Metadata CRUD ─────────────────────────────────────────────────────────────

describe('ChartStorage – metadata operations', () => {
  it('addMeta inserts metadata into an existing group', () => {
    const s = new ChartStorage([makeGroup('g', 'g', ['m1'])]);
    expect(s.addMeta('g', { id: 'm2', label: 'M2' })).toBe(true);
    expect(s.getMetaIds()).toEqual(expect.arrayContaining(['m1', 'm2']));
  });

  it('addMeta warns and returns false for unknown group', () => {
    const s = new ChartStorage();
    const warn = jest.fn();
    expect(s.addMeta('missing', { id: 'x', label: '' }, warn)).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('addMeta warns when metadata id already exists in the group', () => {
    const s = new ChartStorage([makeGroup('g', 'g', ['m1'])]);
    const warn = jest.fn();
    expect(s.addMeta('g', { id: 'm1', label: '' }, warn)).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('updateMeta propagates changes to all registered instances', () => {
    const s = new ChartStorage([makeGroup('g', 'g', ['m1'])]);
    expect(s.updateMeta('m1', { label: 'Updated', color: '#00f' })).toBe(true);
    expect(s.getAllMeta().find(m => m.id === 'm1')?.label).toBe('Updated');
  });

  it('updateMeta returns false when metadata id is unknown', () => {
    const s = new ChartStorage();
    expect(s.updateMeta('x', { label: '' })).toBe(false);
  });

  it('upsertMeta creates a new group when metadata is unknown', () => {
    const s = new ChartStorage();
    s.upsertMeta({ id: 'new', label: 'New' });
    expect(s.hasGroup('new')).toBe(true);
  });

  it('upsertMeta updates existing metadata without adding a group', () => {
    const s = new ChartStorage([makeGroup('g', 'g', ['m1'])]);
    s.upsertMeta({ id: 'm1', label: 'Changed', color: '#0f0' });
    expect(s.getGroupList()).toHaveLength(1); // no new group
    expect(s.getAllMeta().find(m => m.id === 'm1')?.label).toBe('Changed');
  });

  it('removeMeta removes from all groups and returns null on unknown id', () => {
    const s = new ChartStorage();
    expect(s.removeMeta('gone')).toBeNull();
  });

  it('removeMeta cleans up data by default', () => {
    const s = new ChartStorage([makeGroup('g', 'g', ['m1'])]);
    s.push(1, [{ id: 'm1', value: 10 }]);
    s.removeMeta('m1');
    expect(s.hasGroup('g')).toBe(false); // group is empty and removed
  });

  it('removeMeta with returnData returns merged points', () => {
    const s = new ChartStorage([makeGroup('g', 'g', ['m1'])]);
    s.push(1, [{ id: 'm1', value: 42 }]);
    const data = s.removeMeta('m1', { returnData: true });
    expect(data).not.toBeNull();
    expect(data![0]).toMatchObject({ time: 1, m1: 42 });
  });

  it('removeMeta with persistData keeps data values in place', () => {
    const s = new ChartStorage([makeGroup('g', 'g', ['m1', 'm2'])]);
    s.push(1, [{ id: 'm1', value: 1 }, { id: 'm2', value: 2 }]);
    s.removeMeta('m1', { persistData: true });
    const group = s.getGroupList()[0];
    expect(group.data[0].m1).toBe(1);
    expect(group.data[0].m2).toBe(2);
  });

  it('removeMetaFromGroup removes from a specific group only', () => {
    const s = new ChartStorage([makeGroup('g1', 'g1', ['m1']), makeGroup('g2', 'g2', ['m1'])]);
    s.removeMetaFromGroup('m1', 'g1');
    expect(s.hasGroup('g1')).toBe(false);
    expect(s.hasGroup('g2')).toBe(true);
  });

  it('moveMeta transfers data and metadata from source to target', () => {
    const s = new ChartStorage([makeGroup('src', 'src', ['m1']), makeGroup('dst', 'dst', ['m2'])]);
    s.push(5, [{ id: 'm1', value: 99 }]);
    expect(s.moveMeta('m1', 'src', 'dst')).toBe(true);
    expect(s.hasGroup('src')).toBe(false); // emptied, auto-removed
    expect(s.getData('m1')![0]).toMatchObject({ time: 5, m1: 99 });
  });

  it('moveMeta copy:true keeps source intact', () => {
    const s = new ChartStorage([makeGroup('src', 'src', ['m1']), makeGroup('dst', 'dst', ['m2'])]);
    s.push(3, [{ id: 'm1', value: 7 }]);
    expect(s.moveMeta('m1', 'src', 'dst', { copy: true })).toBe(true);
    expect(s.hasGroup('src')).toBe(true);
    const ids = s.getMetaIds();
    expect(ids.filter(id => id === 'm1')).toHaveLength(1); // still one logical id
  });

  it('renameMeta renames across all groups', () => {
    const s = new ChartStorage([makeGroup('g', 'g', ['old'])]);
    s.push(1, [{ id: 'old', value: 5 }]);
    expect(s.renameMeta('old', 'new')).toBe(true);
    expect(s.getMetaIds()).toContain('new');
    expect(s.getMetaIds()).not.toContain('old');
    expect(s.getData('new')![0]).toMatchObject({ time: 1, new: 5 });
  });

  it('renameMeta rejects when new id already exists', () => {
    const s = new ChartStorage([makeGroup('g', 'g', ['m1', 'm2'])]);
    const warn = jest.fn();
    expect(s.renameMeta('m1', 'm2', undefined, warn)).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('getAllMeta returns deduplicated metadata', () => {
    const s = new ChartStorage([makeGroup('g1', 'g1', ['m1', 'm2']), makeGroup('g2', 'g2', ['m3'])]);
    expect(s.getAllMeta()).toHaveLength(3);
  });
});

// ── Data mutation ─────────────────────────────────────────────────────────────

describe('ChartStorage – push / pushMany', () => {
  it('push appends data points sorted by time', () => {
    const s = new ChartStorage([makeGroup('g', 'g', ['m1'])]);
    s.push(2, [{ id: 'm1', value: 20 }]);
    s.push(1, [{ id: 'm1', value: 10 }]);
    const data = s.getData('m1')!;
    expect(data.map(d => d.time)).toEqual([1, 2]);
  });

  it('push batches multiple meta ids at the same time into one data point', () => {
    const s = new ChartStorage([makeGroup('g', 'g', ['m1', 'm2'])]);
    s.push(5, [{ id: 'm1', value: 1 }, { id: 'm2', value: 2 }]);
    const group = s.getGroupList()[0];
    expect(group.data).toHaveLength(1);
    expect(group.data[0]).toMatchObject({ time: 5, m1: 1, m2: 2 });
  });

  it('push supports per-point time overrides', () => {
    const s = new ChartStorage([makeGroup('g', 'g', ['m1', 'm2'])]);
    s.push(0, [{ id: 'm1', time: 10, value: 1 }, { id: 'm2', time: 20, value: 2 }]);
    const group = s.getGroupList()[0];
    expect(group.data).toHaveLength(2);
  });

  it('push warns on unknown metadata id', () => {
    const s = new ChartStorage();
    const warn = jest.fn();
    s.push(1, [{ id: 'ghost', value: 0 }], warn);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ghost'));
  });

  it('pushMany merges with existing data', () => {
    const s = new ChartStorage([makeGroup('g', 'g', ['m1'])]);
    s.push(1, [{ id: 'm1', value: 1 }]);
    s.pushMany('m1', [{ time: 1, m1: 99 }, { time: 2, m1: 2 }]);
    const data = s.getData('m1')!;
    expect(data).toHaveLength(2);
    expect(data.find(d => d.time === 1)!.m1).toBe(99); // overwritten
  });

  it('pushMany warns on unknown metadata id', () => {
    const s = new ChartStorage();
    const warn = jest.fn();
    s.pushMany('x', [{ time: 1, x: 5 }], warn);
    expect(warn).toHaveBeenCalled();
  });
});

// ── Data queries ──────────────────────────────────────────────────────────────

describe('ChartStorage – getData / getValueAt', () => {
  it('getData returns null for unknown metadata id', () => {
    expect(new ChartStorage().getData('x')).toBeNull();
  });

  it('getData returns null when there are no data points', () => {
    const s = new ChartStorage([makeGroup('g', 'g', ['m1'])]);
    expect(s.getData('m1')).toBeNull();
  });

  it('getData returns merged points from all groups sorted by time', () => {
    const s = new ChartStorage([makeGroup('g1', 'g1', ['m1']), makeGroup('g2', 'g2', ['m1'])]);
    s.pushMany('m1', [{ time: 2, m1: 2 }]);
    const data = s.getData('m1')!;
    expect(data.map(d => d.time)).toEqual([2]);
  });

  it('getValueAt returns undefined for unknown metadata id', () => {
    expect(new ChartStorage().getValueAt('x', 0)).toBeUndefined();
  });

  it('getValueAt returns the closest value by time', () => {
    const s = new ChartStorage([makeGroup('g', 'g', ['m1'])]);
    s.pushMany('m1', [
      { time: 0, m1: 0 },
      { time: 10, m1: 10 },
      { time: 20, m1: 20 },
    ]);
    expect(s.getValueAt('m1', 7)).toBe(10);  // closer to 10
    expect(s.getValueAt('m1', 3)).toBe(0);   // closer to 0
    expect(s.getValueAt('m1', 15)).toBe(10); // equidistant – lower wins per bisect
  });
});

// ── Clear operations ──────────────────────────────────────────────────────────

describe('ChartStorage – clear operations', () => {
  function populatedStorage() {
    const s = new ChartStorage([makeGroup('g1', 'g1', ['m1', 'm2']), makeGroup('g2', 'g2', ['m3'])]);
    s.push(1, [{ id: 'm1', value: 1 }, { id: 'm2', value: 2 }, { id: 'm3', value: 3 }]);
    return s;
  }

  it('clearAll empties all group data arrays', () => {
    const s = populatedStorage();
    s.clearAll();
    s.getGroupList().forEach(g => expect(g.data).toHaveLength(0));
  });

  it('clearGroups clears only specified groups', () => {
    const s = populatedStorage();
    const cleared = s.clearGroups(['g1']);
    expect(cleared.has('g1')).toBe(true);
    expect(s.getGroupList().find(g => g.id === 'g1')!.data).toHaveLength(0);
    expect(s.getGroupList().find(g => g.id === 'g2')!.data).toHaveLength(1);
  });

  it('clearGroups returns empty set for unknown group ids', () => {
    const s = populatedStorage();
    const cleared = s.clearGroups(['nope']);
    expect(cleared.size).toBe(0);
  });

  it('clearMetas clears data for specified metadata ids only', () => {
    const s = populatedStorage();
    const cleared = s.clearMetas(['m1']);
    expect(cleared.has('m1')).toBe(true);
    const g1 = s.getGroupList().find(g => g.id === 'g1')!;
    expect(g1.data[0].m1).toBeUndefined();
    expect(g1.data[0].m2).toBe(2); // m2 untouched
  });

  it('clearMetas clears the whole data array when all meta ids in a group are targeted', () => {
    const s = populatedStorage();
    s.clearMetas(['m1', 'm2']); // clears all of g1
    const g1 = s.getGroupList().find(g => g.id === 'g1')!;
    expect(g1.data).toHaveLength(0);
  });
});
