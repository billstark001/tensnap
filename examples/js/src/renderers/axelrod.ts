import type { GridAgentState } from '@tensnap/core/environment';
import {
  enumField,
  modelBuilder,
  numberField,
} from '@tensnap/js/bindings';
import {
  AxelrodConfig,
  AxelrodMetrics,
  AxelrodState,
  computeAxelrodMetrics,
  initializeAxelrod,
  stepAxelrod,
} from '../models/axelrod';

const CULTURE_LAYER = 'culture';

export const DEFAULT_AXELROD_CONFIG: AxelrodConfig = {
  width: 40,
  height: 40,
  numFeatures: 8,
  numTraits: 10,
  neighborhood: 'moore',
  updatesPerTick: 200,
};

interface AxelrodRuntime {
  config: AxelrodConfig;
  state: AxelrodState;
  stepCount: number;
  lastMetrics: AxelrodMetrics;
}

function createCultureAgents(
  state: AxelrodState,
  config: AxelrodConfig,
): GridAgentState[] {
  const max = Math.max(1, config.numTraits - 1);
  return state.agents.flat().map((agent) => {
    const [f0 = 0, f1 = 0, f2 = 0] = agent.features;
    const r = Math.round((f0 / max) * 255);
    const g = Math.round((f1 / max) * 255);
    const b = Math.round((f2 / max) * 255);

    return {
      id: `a_${agent.row}_${agent.col}`,
      x: agent.col,
      y: agent.row,
      heading: 0,
      icon: 'square',
      size: 0.92,
      color: `rgb(${r}, ${g}, ${b})`,
      data: { features: [...agent.features] },
    };
  });
}

function parseCultureRecord(item: Record<string, unknown>): { row: number; col: number; features: number[] } {
  const id = item.id;
  const col = item.x;
  const row = item.y;
  const data = item.data;
  const features = typeof data === 'object' && data !== null
    ? (data as Record<string, unknown>).features
    : undefined;
  if (typeof id !== 'string' || typeof col !== 'number' || typeof row !== 'number'
    || !Number.isInteger(col) || !Number.isInteger(row)
    || id !== `a_${row}_${col}` || !Array.isArray(features)
    || features.some((feature) => typeof feature !== 'number' || !Number.isInteger(feature))) {
    throw new Error('Restored culture agents require canonical IDs, integer coordinates, and data.features integer arrays.');
  }
  return { row, col, features: [...features] as number[] };
}

function restoreCultureMetadata(runtime: AxelrodRuntime, metadata: Record<string, unknown>): void {
  const width = metadata.width;
  const height = metadata.height;
  const totalUpdates = metadata.total_updates;
  if (typeof width !== 'number' || typeof height !== 'number'
    || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
    || (totalUpdates !== undefined && (typeof totalUpdates !== 'number' || !Number.isInteger(totalUpdates) || totalUpdates < 0))) {
    throw new Error('Restored culture metadata requires positive integer width/height and optional non-negative total_updates.');
  }
  runtime.config.width = width;
  runtime.config.height = height;
  runtime.state = initializeAxelrod(runtime.config);
  runtime.state.totalUpdates = totalUpdates ?? 0;
}

function restoreCultureAgent(runtime: AxelrodRuntime, item: Record<string, unknown>): void {
  const { row, col, features } = parseCultureRecord(item);
  if (row < 0 || row >= runtime.config.height || col < 0 || col >= runtime.config.width
    || features.length !== runtime.config.numFeatures) {
    throw new Error('Restored culture agent is outside the configured grid or has the wrong feature count.');
  }
  runtime.state.agents[row][col] = {
    id: row * runtime.config.width + col,
    row,
    col,
    features,
  };
}

function validateCultureRestore(runtime: AxelrodRuntime, layer: { metadata?: Record<string, unknown>; items?: Array<Record<string, unknown>> }): void {
  const width = layer.metadata?.width ?? runtime.config.width;
  const height = layer.metadata?.height ?? runtime.config.height;
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error('Restored culture metadata requires integer width and height.');
  }
  const items = layer.items ?? [];
  if (items.length !== width * height) {
    throw new Error('Restored culture layer must contain one agent for every grid cell.');
  }
  const occupied = new Set<string>();
  for (const item of items) {
    const { row, col, features } = parseCultureRecord(item);
    if (row < 0 || row >= height || col < 0 || col >= width || features.length !== runtime.config.numFeatures
      || features.some((feature) => feature < 0 || feature >= runtime.config.numTraits)) {
      throw new Error('Restored culture agent is outside the configured grid or has the wrong feature count.');
    }
    const key = `${row}:${col}`;
    if (occupied.has(key)) throw new Error('Restored culture agents must occupy unique grid cells.');
    occupied.add(key);
  }
}

const builder = modelBuilder({
  id: 'axelrod',
  name: 'Axelrod Cultural Dissemination',
  description: 'Local interaction drives convergence and global polarization of cultural traits.',
  stateSchemaVersion: '1',
}, {
  defaults: DEFAULT_AXELROD_CONFIG,
  create(config): AxelrodRuntime {
    const state = initializeAxelrod(config);
    return {
      config: { ...config },
      state,
      stepCount: 0,
      lastMetrics: computeAxelrodMetrics(state),
    };
  },
  init(runtime) {
    runtime.state = initializeAxelrod(runtime.config);
    runtime.stepCount = 0;
    runtime.lastMetrics = computeAxelrodMetrics(runtime.state);
  },
  step(runtime) {
    const updatesPerTick = Math.max(1, Math.floor(runtime.config.updatesPerTick ?? 1));
    for (let i = 0; i < updatesPerTick; i++) {
      stepAxelrod(runtime.state);
    }
    runtime.stepCount += 1;
    runtime.lastMetrics = computeAxelrodMetrics(runtime.state);
    return true;
  },
  reset(runtime) {
    runtime.state = initializeAxelrod(runtime.config);
    runtime.stepCount = 0;
    runtime.lastMetrics = computeAxelrodMetrics(runtime.state);
  },
  time(runtime) {
    return runtime.stepCount;
  },
  getConfig(runtime) {
    return runtime.config;
  },
  sceneRestore: {
    mode: 'compose',
    beforeApply(runtime, payload) {
      if (payload.envs?.some((environment) => environment.layers.some((layer) => layer.layer_id === CULTURE_LAYER))) {
        runtime.state = initializeAxelrod(runtime.config);
      }
    },
    restoreTime(runtime, time) {
      runtime.stepCount = time;
    },
    afterApply(runtime) {
      runtime.lastMetrics = computeAxelrodMetrics(runtime.state);
    },
  },
});

builder.paramsFromConfig<AxelrodConfig>({
  get: (runtime) => runtime.config,
  set(runtime, patch) {
    Object.assign(runtime.config, patch);
  },
  fields: {
    width: numberField({ label: 'Grid Width', integer: true, runtime: false }),
    height: numberField({ label: 'Grid Height', integer: true, runtime: false }),
    numFeatures: numberField({ label: 'Feature Count', integer: true, runtime: false }),
    numTraits: numberField({ label: 'Trait Count', integer: true, runtime: false }),
    neighborhood: enumField({
      label: 'Neighborhood',
      options: ['von-neumann', 'moore', 'extended'],
      runtime: false,
    }),
    updatesPerTick: numberField({
      label: 'Updates Per Tick',
      integer: true,
      min: 1,
      step: 25,
    }),
  },
});

builder.env('main')
  .agentLayer(CULTURE_LAYER, {
    metadata: (runtime) => ({
      width: runtime.config.width,
      height: runtime.config.height,
      total_updates: runtime.state.totalUpdates,
    }),
    items: (runtime) => createCultureAgents(runtime.state, runtime.config),
    restore: {
      validate(runtime, layer) {
        validateCultureRestore(runtime, layer);
      },
      itemIds(runtime) {
        return runtime.state.agents.flat().map((agent) => ({ id: `a_${agent.row}_${agent.col}` }));
      },
      restoreMetadata(runtime, metadata) {
        restoreCultureMetadata(runtime, metadata);
      },
      create(runtime, item) {
        restoreCultureAgent(runtime, item);
      },
      update(runtime, _key, item) {
        restoreCultureAgent(runtime, item);
      },
      delete() {
        // Validation requires a complete grid, so a successful restore has no missing cells.
      },
    },
  });

builder
  .chartGroup('culture_metrics', {
    label: 'Culture Metrics',
    series: [
      { id: 'cultures', label: 'Culture Count', color: '#5f3dc4', get: (runtime) => runtime.lastMetrics.cultures },
      { id: 'regions', label: 'Cultural Regions', color: '#e67700', get: (runtime) => runtime.lastMetrics.regions },
      { id: 'active_edges', label: 'Active Boundaries', color: '#c92a2a', get: (runtime) => runtime.lastMetrics.activeEdges },
      { id: 'mean_similarity', label: 'Mean Neighbor Similarity', color: '#1971c2', get: (runtime) => Number(runtime.lastMetrics.meanSimilarity.toFixed(4)) },
    ],
  })
  .chartGroup('dynamics', {
    label: 'Dynamics',
    series: [{ id: 'updates', label: 'Successful Updates', color: '#087f5b', get: (runtime) => runtime.state.totalUpdates }],
  })
  .monitor('summary', {
    label: 'Culture Summary',
    renderHint: 'table',
    get: (runtime) => ({
      cultures: runtime.lastMetrics.cultures,
      regions: runtime.lastMetrics.regions,
      successful_updates: runtime.state.totalUpdates,
    }),
  });

export const AXELROD_EXAMPLE = builder.build();
