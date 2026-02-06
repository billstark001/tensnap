/**
 * Tests for chart storage
 */

import { InstantiatedChartStorage, instantiateChartMetadata } from '../store/chart';
import { ChartGroupMetadata } from '../types/model';

describe('Chart Storage', () => {
  it('should instantiate chart metadata correctly', () => {
    const metadata: ChartGroupMetadata = {
      id: 'test-chart',
      label: 'Test Chart',
      color: '#ff0000',
    };

    const chart = instantiateChartMetadata(metadata);

    expect(chart.id).toBe('test-chart');
    expect(chart.label).toBe('Test Chart');
    expect(chart.data).toEqual([]);
    expect(chart.metadataDict).toHaveProperty('test-chart');
  });

  it('should add chart groups to storage', () => {
    const chart1 = instantiateChartMetadata({
      id: 'chart1',
      label: 'Chart 1',
    });

    const storage = new InstantiatedChartStorage([chart1]);

    expect(storage.getGroups()).toHaveLength(1);
    expect(storage.getGroups()[0].id).toBe('chart1');
  });

  it('should manage multiple chart groups', () => {
    const chart1 = instantiateChartMetadata({
      id: 'chart1',
      label: 'Chart 1',
    });

    const chart2 = instantiateChartMetadata({
      id: 'chart2',
      label: 'Chart 2',
    });

    const storage = new InstantiatedChartStorage([chart1, chart2]);

    expect(storage.getGroups()).toHaveLength(2);
    
    // Test add chart group
    const chart3 = instantiateChartMetadata({
      id: 'chart3',
      label: 'Chart 3',
    });
    storage.addChartGroup(chart3);
    
    expect(storage.getGroups()).toHaveLength(3);
  });
});
