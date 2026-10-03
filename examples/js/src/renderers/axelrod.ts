import {
  enumField,
  modelBuilder,
  numberField,
} from '@tensnap/js/bindings';
import {
  AxelrodConfig,
  AxelrodMetrics,
  AxelrodState,
  type Agent,
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
  rng: { state: number };
}

function nextRandom(rng: { state: number }): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  let value = Math.imul(rng.state ^ (rng.state >>> 15), 1 | rng.state);
  value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function randomize(runtime: AxelrodRuntime): void {
  runtime.rng.state = Math.floor(Math.random() * 4294967296);
  runtime.state = initializeAxelrod(runtime.config, () => nextRandom(runtime.rng));
  runtime.stepCount = 0;
  runtime.lastMetrics = computeAxelrodMetrics(runtime.state);
}

function restoreAxelrodCheckpoint(runtime: AxelrodRuntime, data: unknown): void {
  if (typeof data !== 'object' || data === null) throw new Error('Axelrod checkpoint must be an object.');
  const record = data as Record<string, unknown>;
  const config = record.config as AxelrodConfig;
  const state = record.state as AxelrodState;
  if (!config || !state || !Array.isArray(state.agents)
    || !Number.isSafeInteger(record.stepCount) || (record.stepCount as number) < 0
    || !Number.isSafeInteger(record.rngState) || (record.rngState as number) < 0
    || (record.rngState as number) > 0xffffffff
    || !Number.isSafeInteger(state.totalUpdates) || state.totalUpdates < 0
    || !Number.isSafeInteger(config.width) || !Number.isSafeInteger(config.height)
    || !Number.isSafeInteger(config.numFeatures) || !Number.isSafeInteger(config.numTraits)
    || config.width <= 0 || config.height <= 0 || config.numFeatures <= 0 || config.numTraits <= 0
    || state.agents.length !== config.height
    || state.agents.some((row, y) => !Array.isArray(row) || row.length !== config.width
      || row.some((agent, x) => agent.row !== y || agent.col !== x
        || !Array.isArray(agent.features) || agent.features.length !== config.numFeatures
        || agent.features.some((feature) => !Number.isInteger(feature) || feature < 0 || feature >= config.numTraits)))) {
    throw new Error('Axelrod checkpoint has invalid dimensions, cultural traits, or RNG state.');
  }
  runtime.config = { ...config };
  runtime.state = {
    config: runtime.config,
    totalUpdates: state.totalUpdates,
    agents: state.agents.map((row) => row.map((agent) => ({
      id: agent.id, row: agent.row, col: agent.col, features: [...agent.features],
    }))),
  };
  runtime.stepCount = record.stepCount as number;
  runtime.rng.state = record.rngState as number;
  runtime.lastMetrics = computeAxelrodMetrics(runtime.state);
}

function cultureColor(runtime: AxelrodRuntime, agent: Agent): string {
  const max = Math.max(1, runtime.config.numTraits - 1);
  const [f0 = 0, f1 = 0, f2 = 0] = agent.features;
  const r = Math.round((f0 / max) * 255);
  const g = Math.round((f1 / max) * 255);
  const b = Math.round((f2 / max) * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

function parseCultureRecord(item: Record<string, unknown>): { row: number; col: number; agent: Agent } {
  const id = item.id;
  const matched = typeof id === 'string' ? /^cell:(0|[1-9]\d*):(0|[1-9]\d*)$/.exec(id) : null;
  const row = matched ? Number(matched[1]) : NaN;
  const col = matched ? Number(matched[2]) : NaN;
  const data = item.data;
  const agent = typeof data === 'object' && data !== null
    ? (data as Record<string, unknown>).value
    : undefined;
  const record = agent as Record<string, unknown> | undefined;
  const features = record?.features;
  if (!Number.isSafeInteger(row) || !Number.isSafeInteger(col)
    || !record || record.row !== row || record.col !== col
    || !Number.isSafeInteger(record.id) || !Array.isArray(features)
    || features.some((feature) => typeof feature !== 'number' || !Number.isInteger(feature))) {
    throw new Error('Restored culture agents require canonical matrix IDs and data.value agents.');
  }
  return { row, col, agent: record as unknown as Agent };
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
  runtime.state = initializeAxelrod(runtime.config, () => 0);
  runtime.state.totalUpdates = totalUpdates ?? 0;
}

function validateCultureRestore(runtime: AxelrodRuntime, layer: { metadata?: Record<string, unknown>; items?: Array<Record<string, unknown>> }): void {
  const width = layer.metadata?.width ?? runtime.config.width;
  const height = layer.metadata?.height ?? runtime.config.height;
  const totalUpdates = layer.metadata?.total_updates;
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isInteger(width) || !Number.isInteger(height)
    || width <= 0 || height <= 0
    || (totalUpdates !== undefined && (!Number.isSafeInteger(totalUpdates) || (totalUpdates as number) < 0))) {
    throw new Error('Restored culture metadata requires integer width and height.');
  }
  const items = layer.items ?? [];
  if (items.length !== width * height) {
    throw new Error('Restored culture layer must contain one agent for every grid cell.');
  }
  const occupied = new Set<string>();
  for (const item of items) {
    const { row, col, agent } = parseCultureRecord(item);
    if (row < 0 || row >= height || col < 0 || col >= width
      || item.x !== col || item.y !== height - 1 - row || agent.id !== row * width + col
      || agent.features.length !== runtime.config.numFeatures
      || agent.features.some((feature) => feature < 0 || feature >= runtime.config.numTraits)) {
      throw new Error('Restored culture agent is outside the configured grid or has the wrong feature count.');
    }
    const key = `${row}:${col}`;
    if (occupied.has(key)) throw new Error('Restored culture agents must occupy unique grid cells.');
    occupied.add(key);
  }
}

function restoreCultureMatrix(runtime: AxelrodRuntime, values: Agent[][]): void {
  runtime.state = {
    config: runtime.config,
    totalUpdates: runtime.state.totalUpdates,
    agents: values.map((row, y) => row.map((agent, x) => ({
      id: y * runtime.config.width + x,
      row: y,
      col: x,
      features: [...agent.features],
    }))),
  };
}

const builder = modelBuilder({
  id: 'axelrod',
  name: 'Axelrod Cultural Dissemination',
  description: 'Local interaction drives convergence and global polarization of cultural traits.',
  stateSchemaVersion: '2',
}, {
  defaults: DEFAULT_AXELROD_CONFIG,
  create(config): AxelrodRuntime {
    const rng = { state: Math.floor(Math.random() * 4294967296) };
    const state = initializeAxelrod(config, () => nextRandom(rng));
    return {
      config: { ...config },
      state,
      stepCount: 0,
      lastMetrics: computeAxelrodMetrics(state),
      rng,
    };
  },
  init(runtime) {
    randomize(runtime);
  },
  step(runtime) {
    const updatesPerTick = Math.max(1, Math.floor(runtime.config.updatesPerTick ?? 1));
    for (let i = 0; i < updatesPerTick; i++) {
      stepAxelrod(runtime.state, () => nextRandom(runtime.rng));
    }
    runtime.stepCount += 1;
    runtime.lastMetrics = computeAxelrodMetrics(runtime.state);
    return true;
  },
  reset(runtime) {
    randomize(runtime);
  },
  time(runtime) {
    return runtime.stepCount;
  },
  getConfig(runtime) {
    return runtime.config;
  },
  checkpoint: {
    capture(runtime) {
      return {
        config: { ...runtime.config },
        state: {
          totalUpdates: runtime.state.totalUpdates,
          agents: runtime.state.agents.map((row) => row.map((agent) => ({
            id: agent.id, row: agent.row, col: agent.col, features: [...agent.features],
          }))),
        },
        stepCount: runtime.stepCount,
        rngState: runtime.rng.state,
      };
    },
    restore(runtime, data) {
      restoreAxelrodCheckpoint(runtime, data);
    },
  },
  sceneRestore: {
    mode: 'compose',
    beforeApply(runtime, payload) {
      if (payload.envs?.some((environment) => environment.layers.some((layer) => layer.layer_id === CULTURE_LAYER))) {
        runtime.state = initializeAxelrod(runtime.config, () => 0);
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
      step: 1,
    }),
  },
});

builder.env('main')
  .matrixAgentLayer(CULTURE_LAYER, {
    metadata: (runtime) => ({
      total_updates: runtime.state.totalUpdates,
    }),
    source: (runtime) => runtime.state.agents,
    fields: {
      heading: 0,
      data: (_runtime, _row, _col, agent) => ({ features: [...agent.features] }),
    },
    color: (runtime, _row, _col, agent) => cultureColor(runtime, agent),
    icon: 'square',
    size: 0.92,
    validate: validateCultureRestore,
    restoreMetadata: restoreCultureMetadata,
    replace: restoreCultureMatrix,
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
