# TenSnap Web Core Migration Guide

## Overview

The `tensnap-web-core` package has been created as a framework-agnostic core for rendering and state management. This document describes the migration and how to use it.

## What Has Been Moved to tensnap-web-core

### 1. Chart Rendering (`src/chart/`)
- `LeaferLineChart.ts` - Canvas-based chart rendering using Leafer-UI
- `gridVisualizer.ts` - Grid environment visualization
- `graphVisualizer.ts` - Graph environment visualization  
- `types.ts` - Chart configuration types

### 2. State Management (`src/store/`)
- `state-manager.ts` - Lightweight state management (Zustand-compatible API)
- `chart.ts` - Chart storage and utilities
- `environment.ts` - Environment instantiation and serialization
- `parameter.ts` - Parameter validation and estimation
- `utils.ts` - State merge utilities
- `slices/` - All state slices (connection, time, environment, parameter, chart, snapshot, log)

### 3. Core Types (`src/types/`)
- `model.ts` - Core data model types (agents, environments, parameters, charts)

### 4. Utility Functions (`src/utils/`)
- `npy-parser.ts` - NumPy file parsing
- `numpy-renderer.ts` - NumPy array rendering
- `msgpack.ts` - MessagePack utilities
- `format-detector.ts` - File format detection
- `common.ts` - Common utilities

## Key Design Decisions

### Framework-Agnostic State Management
The core package implements its own lightweight state management system that mimics Zustand's API but without any React dependencies. This allows:
- Use in Node.js environments
- Use in non-React frameworks
- Better testability in isolation
- Clear separation of concerns

### No UI Framework Dependencies
The core package does NOT include:
- React
- Zustand (uses custom state manager)
- Lingui (internationalization)
- Any UI component libraries

### Update Triggers
The web package's `UpdateTriggerState` pattern has been preserved with `set()` and `reset()` methods that work with the custom state manager.

## Using tensnap-web-core

### Installation
```bash
pnpm add tensnap-web-core@workspace:*
```

### Basic Usage

#### Chart Rendering
```typescript
import { LeaferLineChart } from 'tensnap-web-core/chart';

const container = document.getElementById('chart');
const chart = new LeaferLineChart(container, {
  lines: [
    { key: 'data1', name: 'Series 1', color: '#8884d8' }
  ]
});

chart.setData([
  { time: 0, data1: 10 },
  { time: 1, data1: 20 }
]);
```

#### State Management
```typescript
import { createScenarioStore } from 'tensnap-web-core/store';

const store = createScenarioStore();

// Subscribe to changes
store.subscribe((state, prevState) => {
  console.log('State updated:', state);
});

// Get current state
const state = store.getState();

// Update state
state.setConnected(true);
```

## Integration with tensnap-web

The `tensnap-web` package should:

1. **Import core types and utilities**
   ```typescript
   import type { ChartGroup, Environment, Parameter } from 'tensnap-web-core/types';
   import { InstantiatedChartStorage } from 'tensnap-web-core/store';
   ```

2. **Use core visualizers**
   ```typescript
   import { GridVisualizer } from 'tensnap-web-core/chart';
   ```

3. **Wrap with React hooks**
   - Create React wrappers around core visualizers
   - Use Zustand for React-specific state management
   - Add i18n support in React components

4. **Keep UI-specific code in tensnap-web**
   - View management and layout
   - React components
   - Internationalization
   - WebSocket integration layer

## Testing and Benchmarking

### Run Unit Tests
```bash
cd packages/tensnap-web-core
pnpm test
```

### Run Browser Tests
```bash
cd packages/tensnap-web-core
pnpm test:browser
```

### Run Benchmarks
```bash
cd packages/tensnap-web-core
pnpm benchmark
```

## Migration Status

### ✅ Completed
- Core package structure created
- Chart rendering moved and working
- Visualizers moved and working
- State management reimplemented without Zustand
- All TypeScript compilation succeeds
- Unit tests added and passing (6/6 tests)
- Browser test infrastructure created
- Benchmarking infrastructure created

### 🚧 Remaining Work
- Update web package imports to use core package where appropriate
- Create React wrappers for core functionality
- Remove duplicated code from web package
- Add view slice back to web package (it's UI-specific)
- Full integration testing
- Update documentation

## Architecture Benefits

1. **Separation of Concerns**: Core logic is independent of UI framework
2. **Testability**: Core can be tested without DOM or React
3. **Reusability**: Core can be used in different contexts (Node.js, other frameworks)
4. **Performance**: Can benchmark core without UI overhead
5. **Maintainability**: Clear boundaries between layers

## Notes for Developers

- The core package uses a custom state manager that mimics Zustand's API
- Type definitions in core are minimal - web package can extend them
- WebSocket handling stays in web package as it's integration-specific
- View/layout management is UI-specific and stays in web package
