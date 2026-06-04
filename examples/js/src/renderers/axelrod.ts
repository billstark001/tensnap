import type { GridAgentState } from '@tensnap/core/environment';
import {
  defineCharts,
  defineExample,
  defineEnvironment,
  defineLayer,
  defineParameters,
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

function createAxelrodParameters(config: AxelrodConfig) {
  return defineParameters(
    { id: 'width', type: 'number', label: 'Grid Width', value: config.width, min: 10, max: 120, step: 1, allowRuntimeChange: false },
    { id: 'height', type: 'number', label: 'Grid Height', value: config.height, min: 10, max: 120, step: 1, allowRuntimeChange: false },
    { id: 'numFeatures', type: 'number', label: 'Feature Count', value: config.numFeatures, min: 2, max: 20, step: 1, allowRuntimeChange: false },
    { id: 'numTraits', type: 'number', label: 'Trait Count', value: config.numTraits, min: 2, max: 20, step: 1, allowRuntimeChange: false },
    { id: 'neighborhood', type: 'enum', label: 'Neighborhood', value: config.neighborhood ?? 'moore', options: ['von-neumann', 'moore', 'extended'], allowRuntimeChange: false },
    { id: 'updatesPerTick', type: 'number', label: 'Updates Per Tick', value: config.updatesPerTick ?? 200, min: 1, max: 2000, step: 25, allowRuntimeChange: true },
  );
}

const AXELROD_CHARTS = defineCharts(
  { id: 'cultures', label: 'Culture Count', color: '#5f3dc4' },
  { id: 'regions', label: 'Cultural Regions', color: '#e67700' },
  { id: 'active_edges', label: 'Active Boundaries', color: '#c92a2a' },
  { id: 'mean_similarity', label: 'Mean Neighbor Similarity', color: '#1971c2' },
  { id: 'updates', label: 'Successful Updates', color: '#087f5b' },
);

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
    const color = `rgb(${r}, ${g}, ${b})`;

    return {
      id: `a_${agent.row}_${agent.col}`,
      x: agent.col,
      y: agent.row,
      heading: 0,
      icon: 'square' as const,
      size: 0.92,
      color,
    };
  });
}

export const AXELROD_EXAMPLE = defineExample({
  id: 'axelrod',
  name: 'Axelrod Cultural Dissemination',
  description: 'Local interaction drives convergence and global polarization of cultural traits.',
}, {
  defaults: DEFAULT_AXELROD_CONFIG,
  parameters: createAxelrodParameters,
  environments(config) {
    return [
      defineEnvironment({
        id: 'main',
        type: '2d',
        layers: [
          defineLayer({
            layerId: CULTURE_LAYER,
            layerType: 'agent',
            data: { width: config.width, height: config.height },
          }),
        ],
      }),
    ];
  },
  charts: AXELROD_CHARTS,
  create(config) {
    const state = initializeAxelrod(config);
    return {
      config,
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
  async sync(runtime, ctx) {
    await ctx.syncItems('main', CULTURE_LAYER, createCultureAgents(runtime.state, runtime.config));
    await ctx.setTime(0);
    await publishAxelrodCharts(runtime.lastMetrics, runtime.state.totalUpdates, 0, ctx);
  },
  async onParameterChange(runtime, payload, ctx) {
    if (payload.id !== 'updatesPerTick' || typeof payload.value !== 'number') {
      return;
    }
    runtime.config.updatesPerTick = Math.max(1, Math.floor(payload.value));
    await ctx.refreshParameters(payload.id);
  },
  async step(runtime, ctx) {
    const updatesPerTick = Math.max(1, Math.floor(runtime.config.updatesPerTick ?? 1));
    for (let i = 0; i < updatesPerTick; i++) {
      stepAxelrod(runtime.state);
    }
    runtime.stepCount += 1;
    const time = runtime.stepCount;
    runtime.lastMetrics = computeAxelrodMetrics(runtime.state);

    await ctx.setTime(time);
    await ctx.syncItems('main', CULTURE_LAYER, createCultureAgents(runtime.state, runtime.config));
    await publishAxelrodCharts(runtime.lastMetrics, runtime.state.totalUpdates, time, ctx);

    return true;
  },
  async reset(runtime, ctx) {
    runtime.state = initializeAxelrod(runtime.config);
    runtime.stepCount = 0;
    await ctx.clearAllCharts();
    runtime.lastMetrics = computeAxelrodMetrics(runtime.state);
    await ctx.sync();
  },
});

async function publishAxelrodCharts(
  metrics: AxelrodMetrics,
  totalUpdates: number,
  time: number,
  ctx: {
    setChartValues(values: Readonly<Record<string, number>>, time?: number): Promise<void>;
  },
): Promise<void> {
  await ctx.setChartValues({
    cultures: metrics.cultures,
    regions: metrics.regions,
    active_edges: metrics.activeEdges,
    mean_similarity: Number(metrics.meanSimilarity.toFixed(4)),
    updates: totalUpdates,
  }, time);
}
