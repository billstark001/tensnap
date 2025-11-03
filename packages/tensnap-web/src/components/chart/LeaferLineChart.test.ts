import { LeaferLineChart } from './LeaferLineChart';
import { ChartDataPoint, ChartConfig } from './types';

// Mock leafer-ui
jest.mock('leafer-ui', () => ({
  Leafer: jest.fn().mockImplementation(() => ({
    add: jest.fn(),
    resize: jest.fn(),
    destroy: jest.fn(),
  })),
  Group: jest.fn().mockImplementation(() => ({
    add: jest.fn(),
    remove: jest.fn(),
    clear: jest.fn(),
  })),
  Line: jest.fn(),
  Text: jest.fn(),
  Rect: jest.fn(),
  // also provide a default export in case the module is imported as default
  default: jest.fn().mockImplementation(() => ({
    add: jest.fn(),
    resize: jest.fn(),
    destroy: jest.fn(),
  })),
}));

describe('LeaferLineChart', () => {
  let container: HTMLDivElement;
  let chart: LeaferLineChart;
  let config: ChartConfig;

  beforeEach(() => {
    container = document.createElement('div');
    config = {
      width: 800,
      height: 400,
      lines: [
        { key: 'value1', name: 'Line 1', color: '#8884d8' },
        { key: 'value2', name: 'Line 2', color: '#82ca9d' },
      ],
    };
  });

  afterEach(() => {
    if (chart) {
      chart.destroy();
    }
  });

  describe('initialization', () => {
    it('should create chart instance', () => {
      chart = new LeaferLineChart(container, config);
      expect(chart).toBeDefined();
    });

    it('should initialize with provided config', () => {
      chart = new LeaferLineChart(container, config);
      expect(chart).toBeInstanceOf(LeaferLineChart);
    });
  });

  describe('updateData', () => {
    it('should update chart with new data', () => {
      chart = new LeaferLineChart(container, config);
      const data: ChartDataPoint[] = [
        { time: 0, value1: 10, value2: 20 },
        { time: 1, value1: 15, value2: 25 },
        { time: 2, value1: 12, value2: 22 },
      ];

      expect(() => chart.updateData(data)).not.toThrow();
    });

    it('should handle empty data', () => {
      chart = new LeaferLineChart(container, config);
      expect(() => chart.updateData([])).not.toThrow();
    });

    it('should handle single data point', () => {
      chart = new LeaferLineChart(container, config);
      const data: ChartDataPoint[] = [
        { time: 0, value1: 10, value2: 20 },
      ];

      expect(() => chart.updateData(data)).not.toThrow();
    });

    it('should handle large datasets', () => {
      chart = new LeaferLineChart(container, config);
      const data: ChartDataPoint[] = Array.from({ length: 10000 }, (_, i) => ({
        time: i,
        value1: Math.sin(i / 100) * 50,
        value2: Math.cos(i / 100) * 50,
      }));

      expect(() => chart.updateData(data)).not.toThrow();
    });
  });

  describe('updateConfig', () => {
    it('should update chart configuration', () => {
      chart = new LeaferLineChart(container, config);
      const newConfig: Partial<ChartConfig> = {
        showGrid: false,
        showXAxis: false,
      };

      expect(() => chart.updateConfig(newConfig)).not.toThrow();
    });

    it('should update line configurations', () => {
      chart = new LeaferLineChart(container, config);
      const newConfig: Partial<ChartConfig> = {
        lines: [
          { key: 'value1', name: 'Updated Line', color: '#ff0000' },
        ],
      };

      expect(() => chart.updateConfig(newConfig)).not.toThrow();
    });
  });

  describe('resize', () => {
    it('should resize chart', () => {
      chart = new LeaferLineChart(container, config);
      expect(() => chart.resize(1000, 500)).not.toThrow();
    });

    it('should handle zero dimensions', () => {
      chart = new LeaferLineChart(container, config);
      expect(() => chart.resize(0, 0)).not.toThrow();
    });
  });

  describe('destroy', () => {
    it('should clean up resources', () => {
      chart = new LeaferLineChart(container, config);
      expect(() => chart.destroy()).not.toThrow();
    });

    it('should allow multiple destroy calls', () => {
      chart = new LeaferLineChart(container, config);
      chart.destroy();
      expect(() => chart.destroy()).not.toThrow();
    });
  });

  describe('data bounds calculation', () => {
    it('should handle negative values', () => {
      chart = new LeaferLineChart(container, config);
      const data: ChartDataPoint[] = [
        { time: 0, value1: -10, value2: -20 },
        { time: 1, value1: -5, value2: -15 },
        { time: 2, value1: 5, value2: 10 },
      ];

      expect(() => chart.updateData(data)).not.toThrow();
    });

    it('should handle very large values', () => {
      chart = new LeaferLineChart(container, config);
      const data: ChartDataPoint[] = [
        { time: 0, value1: 1e6, value2: 1e7 },
        { time: 1, value1: 2e6, value2: 2e7 },
      ];

      expect(() => chart.updateData(data)).not.toThrow();
    });

    it('should handle mixed data types', () => {
      chart = new LeaferLineChart(container, config);
      const data: ChartDataPoint[] = [
        { time: 0, value1: 10, value2: 'string' as string | number },
        { time: 1, value1: 15, value2: 25 },
      ];

      expect(() => chart.updateData(data)).not.toThrow();
    });
  });

  describe('high-frequency updates', () => {
    it('should handle rapid successive updates', () => {
      chart = new LeaferLineChart(container, config);
      const updates = 100;
      
      for (let i = 0; i < updates; i++) {
        const data: ChartDataPoint[] = [
          { time: i, value1: Math.random() * 100, value2: Math.random() * 100 },
        ];
        expect(() => chart.updateData(data)).not.toThrow();
      }
    });

    it('should maintain performance with growing datasets', () => {
      chart = new LeaferLineChart(container, config);
      const data: ChartDataPoint[] = [];
      
      for (let i = 0; i < 100; i++) {
        data.push({ time: i, value1: Math.random() * 100, value2: Math.random() * 100 });
        const startTime = performance.now();
        chart.updateData([...data]);
        const endTime = performance.now();
        
        // Update should complete in reasonable time (< 100ms)
        expect(endTime - startTime).toBeLessThan(100);
      }
    });
  });
});
