import type { GridAgentState } from '@tensnap/core/environment';
import {
  defineCharts,
  defineExample,
  defineEnvironment,
  defineLayer,
  defineParameters,
} from '@tensnap/js/bindings';
import {
  TornbergConfig,
  TornbergState,
  computeSorting,
  initializeTornberg,
  stepTornberg,
} from '../models/tornberg';

const PARTISAN_LAYER = 'partisan';
const SORTING_SAMPLE_INTERVAL = 10;

export const DEFAULT_TORNBERG_CONFIG: TornbergConfig = {
  width: 30,
  height: 30,
  numFeatures: 10,
  numTraits: 10,
  numPartisans: 2,
  partisanWeight: 4,
  gamma: 0.25,
  homophilyH: 4,
};

function createTornbergParameters(config: TornbergConfig) {
  return defineParameters(
    { id: 'width', type: 'number', label: 'Grid Width', value: config.width, min: 10, max: 120, step: 1, allowRuntimeChange: false },
    { id: 'height', type: 'number', label: 'Grid Height', value: config.height, min: 10, max: 120, step: 1, allowRuntimeChange: false },
    { id: 'numFeatures', type: 'number', label: 'Feature Count', value: config.numFeatures, min: 2, max: 20, step: 1, allowRuntimeChange: false },
    { id: 'numTraits', type: 'number', label: 'Trait Count', value: config.numTraits, min: 2, max: 20, step: 1, allowRuntimeChange: false },
    { id: 'numPartisans', type: 'number', label: 'Partisans', value: config.numPartisans, min: 2, max: 6, step: 1, allowRuntimeChange: false },
    { id: 'partisanWeight', type: 'number', label: 'Partisan Weight', value: config.partisanWeight, min: 1, max: 20, step: 1, allowRuntimeChange: false },
    { id: 'gamma', type: 'number', label: 'Gamma', value: config.gamma, min: 0, max: 1, step: 0.05, allowRuntimeChange: false },
    { id: 'homophilyH', type: 'number', label: 'Homophily Exponent', value: config.homophilyH, min: 1, max: 12, step: 1, allowRuntimeChange: false },
  );
}

const TORNBERG_CHARTS = defineCharts(
  { id: 'sorting', label: 'Sorting Psi', color: '#c92a2a' },
  { id: 'updates', label: 'Updates', color: '#1971c2' },
);

function createPartisanAgents(state: TornbergState): GridAgentState[] {
  const palette = ['#e03131', '#1971c2', '#2f9e44', '#f08c00', '#9c36b5', '#0b7285'];
  return state.agents.flat().map((agent) => ({
    id: `t_${agent.row}_${agent.col}`,
    x: agent.col,
    y: agent.row,
    heading: 0,
    icon: 'square' as const,
    size: 0.92,
    color: palette[agent.partisan % palette.length],
  }) as GridAgentState);
}

export const TORNBERG_EXAMPLE = defineExample({
  id: 'tornberg',
  name: 'Tornberg Partisan Sorting',
  description: 'Digital-media reach and homophily amplify partisan sorting in cultural space.',
}, {
  defaults: DEFAULT_TORNBERG_CONFIG,
  parameters: createTornbergParameters,
  environments(config) {
    return [
      defineEnvironment({
        id: 'main',
        type: '2d',
        layers: [
          defineLayer({
            layerId: PARTISAN_LAYER,
            layerType: 'agent',
            data: { width: config.width, height: config.height },
          }),
        ],
      }),
    ];
  },
  charts: TORNBERG_CHARTS,
  create(config) {
    return {
      config,
      state: initializeTornberg(config),
      stepCount: 0,
      lastSorting: 0,
    };
  },
  init(runtime) {
    runtime.state = initializeTornberg(runtime.config);
    runtime.stepCount = 0;
    runtime.lastSorting = computeSorting(runtime.state);
  },
  async sync(runtime, ctx) {
    await ctx.syncItems('main', PARTISAN_LAYER, createPartisanAgents(runtime.state));
    await ctx.setTime(0);
    await ctx.setChartValues({
      sorting: runtime.lastSorting,
      updates: runtime.state.totalUpdates,
    }, 0);
  },
  async step(runtime, ctx) {
    stepTornberg(runtime.state);
    runtime.stepCount += 1;
    const time = runtime.stepCount;

    if (time % SORTING_SAMPLE_INTERVAL === 0) {
      runtime.lastSorting = computeSorting(runtime.state);
    }

    await ctx.setTime(time);
    await ctx.syncItems('main', PARTISAN_LAYER, createPartisanAgents(runtime.state));
    await ctx.setChartValues({
      sorting: runtime.lastSorting,
      updates: runtime.state.totalUpdates,
    }, time);

    return true;
  },
  async reset(runtime, ctx) {
    runtime.state = initializeTornberg(runtime.config);
    runtime.stepCount = 0;
    runtime.lastSorting = computeSorting(runtime.state);
    await ctx.sync();
    await ctx.clearAllCharts();
  },
});