import { InstantiatedChartStorage, instantiateChartMetadata, createCsvContent } from './chart';
import { ChartGroup, ChartGroupMetadata, ChartMetadata } from '@/types/model';

describe('instantiateChartMetadata', () => {
  it('should create chart group from metadata with dataList', () => {
    const meta: ChartGroupMetadata = {
      id: 'group1',
      label: 'Group 1',
      dataList: [
        { id: 'chart1', label: 'Chart 1' },
        { id: 'chart2', label: 'Chart 2' },
      ],
    };

    const result = instantiateChartMetadata(meta);

    expect(result.id).toBe('group1');
    expect(result.label).toBe('Group 1');
    expect(result.data).toEqual([]);
    expect(Object.keys(result.metadataDict)).toEqual(['chart1', 'chart2']);
  });

  it('should create chart group from metadata without dataList', () => {
    const meta: ChartGroupMetadata = {
      id: 'chart1',
      label: 'Chart 1',
    };

    const result = instantiateChartMetadata(meta);

    expect(result.id).toBe('chart1');
    expect(result.metadataDict).toEqual({ chart1: meta });
  });
});

describe('createCsvContent', () => {
  it('should create CSV content correctly', () => {
    const chartGroup: ChartGroup = {
      id: 'group1',
      label: 'Group 1',
      metadataDict: {
        chart1: { id: 'chart1', label: 'Chart 1' },
        chart2: { id: 'chart2', label: 'Chart 2' },
      },
      data: [
        { time: 1000, chart1: 10, chart2: 20 },
        { time: 2000, chart1: 15 },
        { time: 3000, chart2: 25 },
      ],
    };

    const csv = createCsvContent(chartGroup);

    expect(csv).toBe(
      'time,chart1,chart2\n' +
      '1000,10,20\n' +
      '2000,15,\n' +
      '3000,,25'
    );
  });
});

describe('InstantiatedChartStorage', () => {
  let storage: InstantiatedChartStorage;
  let group1: ChartGroup;
  let group2: ChartGroup;

  beforeEach(() => {
    group1 = {
      id: 'group1',
      label: 'Group 1',
      metadataDict: {
        chart1: { id: 'chart1', label: 'Chart 1' },
        chart2: { id: 'chart2', label: 'Chart 2' },
      },
      data: [],
    };

    group2 = {
      id: 'group2',
      label: 'Group 2',
      metadataDict: {
        chart3: { id: 'chart3', label: 'Chart 3' },
      },
      data: [],
    };

    storage = new InstantiatedChartStorage([group1, group2]);
  });

  describe('constructor and getGroups', () => {
    it('should initialize with groups', () => {
      expect(storage.getGroups()).toHaveLength(2);
      expect(storage.allChartGroups.size).toBe(2);
    });

    it('should register metadata correctly', () => {
      expect(storage.getAllChartIds()).toEqual(['chart1', 'chart2', 'chart3']);
    });
  });

  describe('addChartGroup', () => {
    it('should add new group', () => {
      const newGroup: ChartGroup = {
        id: 'group3',
        label: 'Group 3',
        metadataDict: {
          chart4: { id: 'chart4', label: 'Chart 4' },
        },
        data: [],
      };

      storage.addChartGroup(newGroup);

      expect(storage.getGroups()).toHaveLength(3);
      expect(storage.getAllChartIds()).toContain('chart4');
    });

    it('should upsert existing group', () => {
      const updatedGroup: ChartGroup = {
        id: 'group1',
        label: 'Updated Group 1',
        metadataDict: {
          chart1: { id: 'chart1', label: 'Chart 1' },
          chart4: { id: 'chart4', label: 'Chart 4' },
        },
        data: [{ time: 1000, chart1: 10 }],
      };

      storage.addChartGroup(updatedGroup, true);

      const group = storage.allChartGroups.get('group1')!;
      expect(group.label).toBe('Updated Group 1');
      expect(Object.keys(group.metadataDict)).toHaveLength(3); // chart1, chart2, chart4
      expect(group.data).toHaveLength(1);
    });
  });

  describe('upsertChartMetadata', () => {
    it('should update existing metadata', () => {
      const updated: ChartMetadata = {
        id: 'chart1',
        label: 'Updated Chart 1',
        color: 'red',
      };

      storage.upsertChartMetadata(updated);

      const group = storage.allChartGroups.get('group1')!;
      expect(group.metadataDict.chart1.label).toBe('Updated Chart 1');
      expect(group.metadataDict.chart1.color).toBe('red');
    });

    it('should create new group if metadata does not exist', () => {
      const newMeta: ChartMetadata = {
        id: 'chart5',
        label: 'Chart 5',
      };

      storage.upsertChartMetadata(newMeta);

      expect(storage.getAllChartIds()).toContain('chart5');
      expect(storage.allChartGroups.has('chart5')).toBe(true);
    });
  });

  describe('removeChartGroup', () => {
    it('should remove group and clean up metadata', () => {
      const result = storage.removeChartGroup('group1');

      expect(result).toBe(true);
      expect(storage.getGroups()).toHaveLength(1);
      expect(storage.getAllChartIds()).toEqual(['chart3']);
    });

    it('should return false if group does not exist', () => {
      const result = storage.removeChartGroup('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('removeChartMetadataFromGroup', () => {
    it('should remove metadata from specific group', () => {
      storage.push(1000, [
        { id: 'chart1', value: 10 },
        { id: 'chart2', value: 20 },
      ]);

      const result = storage.removeChartMetadataFromGroup('chart1', 'group1');

      expect(result).toBeNull();
      expect(storage.allChartGroups.has('group1')).toBe(true);
      const group = storage.allChartGroups.get('group1')!;
      expect(Object.keys(group.metadataDict)).toEqual(['chart2']);
      expect(group.data[0].chart1).toBeUndefined();
      expect(group.data[0].chart2).toBe(20);
    });

    it('should remove entire group if it is the only metadata', () => {
      storage.push(1000, [{ id: 'chart3', value: 30 }]);

      const result = storage.removeChartMetadataFromGroup('chart3', 'group2');

      expect(result).toBeNull();
      expect(storage.allChartGroups.has('group2')).toBe(false);
    });

    it('should return data when returnData is true', () => {
      storage.push(1000, [{ id: 'chart1', value: 10 }]);
      storage.push(2000, [{ id: 'chart1', value: 20 }]);

      const result = storage.removeChartMetadataFromGroup('chart1', 'group1', { returnData: true });

      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);
      expect(result![0]).toEqual({ time: 1000, chart1: 10 });
      expect(result![1]).toEqual({ time: 2000, chart1: 20 });
    });

    it('should persist data when persistData is true', () => {
      storage.push(1000, [
        { id: 'chart1', value: 10 },
        { id: 'chart2', value: 20 },
      ]);

      storage.removeChartMetadataFromGroup('chart1', 'group1', { persistData: true });

      const group = storage.allChartGroups.get('group1')!;
      expect(group.data[0].chart1).toBe(10);
      expect(group.data[0].chart2).toBe(20);
    });

    it('should return null if metadata does not exist in group', () => {
      const result = storage.removeChartMetadataFromGroup('chart3', 'group1');
      expect(result).toBeNull();
    });

    it('should return null if group does not exist', () => {
      const result = storage.removeChartMetadataFromGroup('chart1', 'nonexistent');
      expect(result).toBeNull();
    });

    it('should handle both returnData and persistData together', () => {
      storage.push(1000, [
        { id: 'chart1', value: 10 },
        { id: 'chart2', value: 20 },
      ]);

      const result = storage.removeChartMetadataFromGroup('chart1', 'group1', { 
        returnData: true, 
        persistData: true 
      });

      expect(result).toHaveLength(1);
      expect(result![0]).toEqual({ time: 1000, chart1: 10 });
      
      const group = storage.allChartGroups.get('group1')!;
      expect(group.data[0].chart1).toBe(10);
    });
  });

  describe('removeChartMetadata', () => {
    it('should remove groups with single metadata', () => {
      const result = storage.removeChartMetadata('chart3');

      expect(result).not.toBeNull();
      expect(storage.allChartGroups.has('group2')).toBe(false);
      expect(storage.getAllChartIds()).not.toContain('chart3');
    });

    it('should remove metadata from group with multiple metadata', () => {
      const result = storage.removeChartMetadata('chart1');

      expect(result).not.toBeNull();
      expect(storage.allChartGroups.has('group1')).toBe(true);
      const group = storage.allChartGroups.get('group1')!;
      expect(Object.keys(group.metadataDict)).toEqual(['chart2']);
    });

    it('should return null if metadata does not exist', () => {
      const result = storage.removeChartMetadata('nonexistent');
      expect(result).toBeNull();
    });

    it('should return data when returnData is true', () => {
      storage.push(1000, [{ id: 'chart1', value: 10 }]);
      storage.push(2000, [{ id: 'chart1', value: 20 }]);
      storage.push(3000, [{ id: 'chart1', value: 30 }]);

      const result = storage.removeChartMetadata('chart1', { returnData: true });

      expect(result).not.toBeNull();
      expect(result).toHaveLength(3);
      expect(result![0]).toEqual({ time: 1000, chart1: 10 });
      expect(result![1]).toEqual({ time: 2000, chart1: 20 });
      expect(result![2]).toEqual({ time: 3000, chart1: 30 });
    });

    it('should persist data when persistData is true', () => {
      storage.push(1000, [
        { id: 'chart1', value: 10 },
        { id: 'chart2', value: 20 },
      ]);

      storage.removeChartMetadata('chart1', { persistData: true });

      const group = storage.allChartGroups.get('group1')!;
      expect(group.data[0].chart1).toBe(10);
      expect(group.data[0].chart2).toBe(20);
    });

    it('should handle metadata in multiple groups', () => {
      // Add chart1 to another group
      const newGroup: ChartGroup = {
        id: 'group3',
        label: 'Group 3',
        metadataDict: {
          chart1: { id: 'chart1', label: 'Chart 1' },
        },
        data: [],
      };
      storage.addChartGroup(newGroup);

      storage.push(1000, [{ id: 'chart1', value: 10 }]);
      storage.push(2000, [{ id: 'chart1', value: 20 }]);

      const result = storage.removeChartMetadata('chart1', { returnData: true });

      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);
      expect(storage.allChartGroups.has('group1')).toBe(true);
      expect(storage.allChartGroups.has('group3')).toBe(false); // Removed because it only had chart1
    });

    it('should return empty array when returnData is false', () => {
      storage.push(1000, [{ id: 'chart1', value: 10 }]);
      const result = storage.removeChartMetadata('chart1', { returnData: false });

      expect(result).toEqual([]);
    });
  });

  describe('getChartData', () => {
    it('should return all data for a metadata', () => {
      storage.push(1000, [{ id: 'chart1', value: 10 }]);
      storage.push(2000, [{ id: 'chart1', value: 20 }]);
      storage.push(3000, [{ id: 'chart1', value: 30 }]);

      const result = storage.getChartData('chart1');

      expect(result).not.toBeNull();
      expect(result).toHaveLength(3);
      expect(result![0]).toEqual({ time: 1000, chart1: 10 });
      expect(result![1]).toEqual({ time: 2000, chart1: 20 });
      expect(result![2]).toEqual({ time: 3000, chart1: 30 });
    });

    it('should return null if metadata does not exist', () => {
      const result = storage.getChartData('nonexistent');
      expect(result).toBeNull();
    });

    it('should return null if no data points exist', () => {
      const result = storage.getChartData('chart1');
      expect(result).toBeNull();
    });

    it('should aggregate data from multiple groups', () => {
      // Add chart1 to another group
      const newGroup: ChartGroup = {
        id: 'group3',
        label: 'Group 3',
        metadataDict: {
          chart1: { id: 'chart1', label: 'Chart 1' },
        },
        data: [],
      };
      storage.addChartGroup(newGroup);

      storage.push(1000, [{ id: 'chart1', value: 10 }]);
      storage.push(2000, [{ id: 'chart1', value: 20 }]);

      const result = storage.getChartData('chart1');

      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);
      expect(result![0]).toEqual({ time: 1000, chart1: 10 });
      expect(result![1]).toEqual({ time: 2000, chart1: 20 });
    });

    it('should return sorted data', () => {
      storage.push(3000, [{ id: 'chart1', value: 30 }]);
      storage.push(1000, [{ id: 'chart1', value: 10 }]);
      storage.push(2000, [{ id: 'chart1', value: 20 }]);

      const result = storage.getChartData('chart1');

      expect(result).not.toBeNull();
      expect(result!.map(d => d.time)).toEqual([1000, 2000, 3000]);
    });

    it('should handle sparse data', () => {
      storage.push(1000, [
        { id: 'chart1', value: 10 },
        { id: 'chart2', value: 20 },
      ]);
      storage.push(2000, [
        { id: 'chart2', value: 30 },
      ]);
      storage.push(3000, [
        { id: 'chart1', value: 40 },
      ]);

      const result = storage.getChartData('chart1');

      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);
      expect(result![0]).toEqual({ time: 1000, chart1: 10 });
      expect(result![1]).toEqual({ time: 3000, chart1: 40 });
    });
  });

  describe('push', () => {
    it('should add data points to groups', () => {
      storage.push(1000, [
        { id: 'chart1', value: 10 },
        { id: 'chart2', value: 20 },
        { id: 'chart3', value: 30 },
      ]);

      const g1 = storage.allChartGroups.get('group1')!;
      const g2 = storage.allChartGroups.get('group2')!;

      expect(g1.data).toHaveLength(1);
      expect(g1.data[0]).toEqual({ time: 1000, chart1: 10, chart2: 20 });

      expect(g2.data).toHaveLength(1);
      expect(g2.data[0]).toEqual({ time: 1000, chart3: 30 });
    });

    it('should handle custom time', () => {
      storage.push(1000, [
        { id: 'chart1', time: 2000, value: 10 },
      ]);

      const g1 = storage.allChartGroups.get('group1')!;
      expect(g1.data[0].time).toBe(2000);
    });

    it('should warn about unknown chart ids', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      storage.push(1000, [{ id: 'unknown', value: 10 }]);

      expect(consoleSpy).toHaveBeenCalledWith('Chart with id unknown not found.');
      consoleSpy.mockRestore();
    });

    it('should group data points by time', () => {
      storage.push(1000, [
        { id: 'chart1', time: 1000, value: 10 },
        { id: 'chart2', time: 1000, value: 20 },
      ]);

      const g1 = storage.allChartGroups.get('group1')!;
      expect(g1.data).toHaveLength(1);
      expect(g1.data[0]).toEqual({ time: 1000, chart1: 10, chart2: 20 });
    });

    it('should maintain chronological order when pushing in order', () => {
      storage.push(1000, [{ id: 'chart1', value: 10 }]);
      storage.push(2000, [{ id: 'chart1', value: 20 }]);
      storage.push(3000, [{ id: 'chart1', value: 30 }]);

      const g1 = storage.allChartGroups.get('group1')!;
      expect(g1.data).toHaveLength(3);
      expect(g1.data[0].time).toBe(1000);
      expect(g1.data[1].time).toBe(2000);
      expect(g1.data[2].time).toBe(3000);
    });

    it('should sort data when pushing out of order', () => {
      storage.push(3000, [{ id: 'chart1', value: 30 }]);
      storage.push(1000, [{ id: 'chart1', value: 10 }]);
      storage.push(2000, [{ id: 'chart1', value: 20 }]);

      const g1 = storage.allChartGroups.get('group1')!;
      expect(g1.data).toHaveLength(3);
      expect(g1.data[0].time).toBe(1000);
      expect(g1.data[1].time).toBe(2000);
      expect(g1.data[2].time).toBe(3000);
    });

    it('should handle mixed in-order and out-of-order pushes', () => {
      storage.push(1000, [{ id: 'chart1', value: 10 }]);
      storage.push(2000, [{ id: 'chart1', value: 20 }]);
      storage.push(1500, [{ id: 'chart1', value: 15 }]);
      storage.push(3000, [{ id: 'chart1', value: 30 }]);

      const g1 = storage.allChartGroups.get('group1')!;
      expect(g1.data).toHaveLength(4);
      expect(g1.data.map(d => d.time)).toEqual([1000, 1500, 2000, 3000]);
      expect(g1.data.map(d => d.chart1)).toEqual([10, 15, 20, 30]);
    });

    it('should maintain order when pushing multiple points with different times', () => {
      storage.push(1000, [
        { id: 'chart1', time: 3000, value: 30 },
        { id: 'chart1', time: 1000, value: 10 },
        { id: 'chart1', time: 2000, value: 20 },
      ]);

      const g1 = storage.allChartGroups.get('group1')!;
      expect(g1.data).toHaveLength(3);
      expect(g1.data.map(d => d.time)).toEqual([1000, 2000, 3000]);
      expect(g1.data.map(d => d.chart1)).toEqual([10, 20, 30]);
    });

    it('should handle pushing to the end efficiently', () => {
      // 先添加一些有序数据
      storage.push(1000, [{ id: 'chart1', value: 10 }]);
      storage.push(2000, [{ id: 'chart1', value: 20 }]);
      
      // 继续添加更晚的数据（应该走快速路径）
      storage.push(3000, [{ id: 'chart1', value: 30 }]);
      storage.push(4000, [{ id: 'chart1', value: 40 }]);

      const g1 = storage.allChartGroups.get('group1')!;
      expect(g1.data).toHaveLength(4);
      expect(g1.data.map(d => d.time)).toEqual([1000, 2000, 3000, 4000]);
    });
  });

  describe('pushMany', () => {
    it('should add multiple data points for a metadata', () => {
      storage.pushMany('chart1', [
        { time: 1000, chart1: 10 },
        { time: 2000, chart1: 20 },
        { time: 3000, chart1: 30 },
      ]);

      const g1 = storage.allChartGroups.get('group1')!;
      expect(g1.data).toHaveLength(3);
      expect(g1.data.map(d => d.chart1)).toEqual([10, 20, 30]);
    });

    it('should sort data points by time', () => {
      storage.pushMany('chart1', [
        { time: 3000, chart1: 30 },
        { time: 1000, chart1: 10 },
        { time: 2000, chart1: 20 },
      ]);

      const g1 = storage.allChartGroups.get('group1')!;
      expect(g1.data).toHaveLength(3);
      expect(g1.data.map(d => d.time)).toEqual([1000, 2000, 3000]);
      expect(g1.data.map(d => d.chart1)).toEqual([10, 20, 30]);
    });

    it('should merge with existing data', () => {
      storage.push(1500, [{ id: 'chart1', value: 15 }]);
      storage.pushMany('chart1', [
        { time: 1000, chart1: 10 },
        { time: 2000, chart1: 20 },
      ]);

      const g1 = storage.allChartGroups.get('group1')!;
      expect(g1.data).toHaveLength(3);
      expect(g1.data.map(d => d.time)).toEqual([1000, 1500, 2000]);
      expect(g1.data.map(d => d.chart1)).toEqual([10, 15, 20]);
    });

    it('should update existing time point', () => {
      storage.push(1000, [{ id: 'chart1', value: 10 }]);
      storage.pushMany('chart1', [
        { time: 1000, chart1: 99 },
      ]);

      const g1 = storage.allChartGroups.get('group1')!;
      expect(g1.data).toHaveLength(1);
      expect(g1.data[0].chart1).toBe(99);
    });

    it('should preserve other metadata in the same group', () => {
      storage.push(1000, [
        { id: 'chart1', value: 10 },
        { id: 'chart2', value: 20 },
      ]);
      storage.pushMany('chart1', [
        { time: 1000, chart1: 99 },
        { time: 2000, chart1: 88 },
      ]);

      const g1 = storage.allChartGroups.get('group1')!;
      expect(g1.data).toHaveLength(2);
      expect(g1.data[0]).toEqual({ time: 1000, chart1: 99, chart2: 20 });
      expect(g1.data[1]).toEqual({ time: 2000, chart1: 88 });
    });

    it('should handle empty data points array', () => {
      storage.push(1000, [{ id: 'chart1', value: 10 }]);
      storage.pushMany('chart1', []);

      const g1 = storage.allChartGroups.get('group1')!;
      expect(g1.data).toHaveLength(1);
      expect(g1.data[0].chart1).toBe(10);
    });

    it('should warn about unknown metadata id', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      storage.pushMany('unknown', [{ time: 1000, unknown: 10 }]);

      expect(consoleSpy).toHaveBeenCalledWith('Chart with id unknown not found.');
      consoleSpy.mockRestore();
    });

    it('should handle data points without the metadata id', () => {
      storage.pushMany('chart1', [
        { time: 1000, chart1: 10 },
        { time: 2000 }, // 没有 chart1 字段
        { time: 3000, chart1: 30 },
      ]);

      const g1 = storage.allChartGroups.get('group1')!;
      expect(g1.data).toHaveLength(2);
      expect(g1.data.map(d => d.time)).toEqual([1000, 3000]);
    });

    it('should work with metadata that appears in multiple groups', () => {
      // 创建一个新的metadata出现在多个group中
      const newGroup: ChartGroup = {
        id: 'group3',
        label: 'Group 3',
        metadataDict: {
          chart1: { id: 'chart1', label: 'Chart 1' },
        },
        data: [],
      };
      storage.addChartGroup(newGroup);

      storage.pushMany('chart1', [
        { time: 1000, chart1: 10 },
        { time: 2000, chart1: 20 },
      ]);

      const g1 = storage.allChartGroups.get('group1')!;
      const g3 = storage.allChartGroups.get('group3')!;

      expect(g1.data).toHaveLength(2);
      expect(g3.data).toHaveLength(2);
      expect(g1.data[0].chart1).toBe(10);
      expect(g3.data[0].chart1).toBe(10);
    });
  });

  describe('clearAll', () => {
    it('should clear all data', () => {
      storage.push(1000, [{ id: 'chart1', value: 10 }]);
      storage.clearAll();

      storage.getGroups().forEach(group => {
        expect(group.data).toEqual([]);
      });
    });
  });

  describe('clearByGroup', () => {
    it('should clear specific groups', () => {
      storage.push(1000, [
        { id: 'chart1', value: 10 },
        { id: 'chart3', value: 30 },
      ]);

      const cleared = storage.clearByGroup(['group1']);

      expect(cleared).toEqual(new Set(['group1']));
      expect(storage.allChartGroups.get('group1')!.data).toEqual([]);
      expect(storage.allChartGroups.get('group2')!.data).toHaveLength(1);
    });
  });

  describe('clearByMetadata', () => {
    it('should clear all data if all metadata cleared', () => {
      storage.push(1000, [
        { id: 'chart1', value: 10 },
        { id: 'chart2', value: 20 },
      ]);

      const cleared = storage.clearByMetadata(['chart1', 'chart2']);

      expect(cleared).toEqual(new Set(['chart1', 'chart2']));
      expect(storage.allChartGroups.get('group1')!.data).toEqual([]);
    });

    it('should remove specific metadata from data points', () => {
      storage.push(1000, [
        { id: 'chart1', value: 10 },
        { id: 'chart2', value: 20 },
      ]);

      storage.clearByMetadata(['chart1']);

      const g1 = storage.allChartGroups.get('group1')!;
      expect(g1.data).toHaveLength(1);
      expect(g1.data[0]).toEqual({ time: 1000, chart2: 20 });
    });
  });

  describe('shallowCopy', () => {
    it('should create shallow copy', () => {
      storage.push(1000, [{ id: 'chart1', value: 10 }]);

      const copy = storage.shallowCopy();

      expect(copy.getGroups()).toHaveLength(2);
      expect(copy.allChartGroups.get('group1')).toBe(storage.allChartGroups.get('group1'));

      // Modifying copy should affect original (shallow copy)
      copy.push(2000, [{ id: 'chart1', value: 20 }]);
      expect(storage.allChartGroups.get('group1')!.data).toHaveLength(2);
    });
  });

  describe('getAllChartMetadata', () => {
    it('should return unique metadata', () => {
      const metadata = storage.getAllChartMetadata();
      const ids = metadata.map(m => m.id);

      expect(ids).toHaveLength(3);
      expect(new Set(ids).size).toBe(3);
    });
  });
});