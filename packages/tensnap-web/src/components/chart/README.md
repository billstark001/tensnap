# Leafer-UI Chart Module

High-performance line chart implementation using Leafer.js, optimized for high-frequency data updates.

## Overview

This module provides a recharts-compatible line chart renderer built on Leafer.js instead of SVG-based libraries. It's designed to handle frequent data updates with many data points without performance degradation from React's reconciliation algorithm.

## Architecture

- **LeaferLineChart**: Core rendering engine (React-independent)
- **LeaferChartView**: React component binding
- **types.ts**: Type definitions compatible with recharts

## Usage

### React Component

```tsx
import { LeaferChartView } from '@/components/chart';

function MyChart() {
  const data = [
    { time: 0, value1: 10, value2: 20 },
    { time: 1, value1: 15, value2: 25 },
    { time: 2, value1: 12, value2: 22 },
  ];

  const config = {
    width: 800,
    height: 400,
    lines: [
      { key: 'value1', name: 'Line 1', color: '#8884d8' },
      { key: 'value2', name: 'Line 2', color: '#82ca9d' },
    ],
    showGrid: true,
    showXAxis: true,
    showYAxis: true,
  };

  return <LeaferChartView data={data} config={config} />;
}
```

### Core API (React-independent)

```typescript
import { LeaferLineChart } from '@/components/chart';

const chart = new LeaferLineChart(container, config);

// Update data
chart.updateData(newData);

// Update configuration
chart.updateConfig({ showGrid: false });

// Resize
chart.resize(1000, 500);

// Clean up
chart.destroy();
```

## Performance Optimization

- Direct canvas rendering via Leafer.js (no SVG DOM overhead)
- Efficient layer-based rendering (grid, axes, lines)
- Minimal re-renders on data updates
- Support for thousands of data points

## Testing

Tests are located in `LeaferLineChart.test.ts` and cover:

- Initialization and configuration
- Data updates (including high-frequency scenarios)
- Bounds calculation
- Edge cases (empty data, large datasets, negative values)
- Performance benchmarks
