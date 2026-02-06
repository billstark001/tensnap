# tensnap-web-core

Core rendering and state management package for TenSnap. This package is framework-agnostic and provides the essential functionality for visualization and state management without dependencies on React, Zustand, or other UI frameworks.

## Features

- **Chart Rendering**: High-performance canvas-based chart rendering using Leafer-UI
- **Visualizers**: Grid, graph, and uniform environment visualizers
- **State Management**: Core state management for scenarios, environments, parameters, and charts
- **Type-Safe**: Full TypeScript support with comprehensive type definitions
- **Framework-Agnostic**: No dependencies on React, Zustand, or other UI frameworks

## Usage

```typescript
import { LeaferLineChart } from 'tensnap-web-core/chart';
import { ScenarioState } from 'tensnap-web-core/store';

// Create a chart
const chart = new LeaferLineChart(container, config);
chart.setData(dataPoints);

// Manage state
const state = new ScenarioState();
state.addEnvironment(environment);
```

## Testing

```bash
# Run unit tests
pnpm test

# Run browser-based tests
pnpm test:browser

# Run benchmarks
pnpm benchmark
```

## Architecture

This package is designed to be:
- **Minimal**: Only essential dependencies (leafer-ui, d3)
- **Testable**: Comprehensive test infrastructure
- **Performant**: Optimized for high-frequency updates
- **Reusable**: Can be used in any JavaScript/TypeScript project
