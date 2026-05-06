import type { GridAgentState } from '@tensnap/core/environment';
import {
  defineCharts,
  defineExample,
  defineEnvironment,
  defineLayer,
  defineParameters,
} from '@tensnap/js/bindings';
import { AxelrodConfig, AxelrodState, countCultures, initializeAxelrod, stepAxelrod } from '../models/axelrod';

const CULTURE_LAYER = 'culture';

export const DEFAULT_AXELROD_CONFIG: AxelrodConfig = {
  width: 40,
  height: 40,
  numFeatures: 8,
  numTraits: 10,
};

function createAxelrodParameters(config: AxelrodConfig) {
  return defineParameters(
    { id: 'width', type: 'number', label: 'Grid Width', value: config.width, min: 10, max: 120, step: 1, allowRuntimeChange: false },
    { id: 'height', type: 'number', label: 'Grid Height', value: config.height, min: 10, max: 120, step: 1, allowRuntimeChange: false },
    { id: 'numFeatures', type: 'number', label: 'Feature Count', value: config.numFeatures, min: 2, max: 20, step: 1, allowRuntimeChange: false },
    { id: 'numTraits', type: 'number', label: 'Trait Count', value: config.numTraits, min: 2, max: 20, step: 1, allowRuntimeChange: false },
  );
}

const AXELROD_CHARTS = defineCharts(
  { id: 'cultures', label: 'Culture Count', color: '#5f3dc4' },
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
    return {
      config,
      state: initializeAxelrod(config),
      stepCount: 0,
    };
  },
  init(runtime) {
    runtime.state = initializeAxelrod(runtime.config);
    runtime.stepCount = 0;
  },
  async sync(runtime, ctx) {
    await ctx.syncItems('main', CULTURE_LAYER, createCultureAgents(runtime.state, runtime.config));
    await ctx.setTime(0);
    await ctx.setChartValues({
      cultures: countCultures(runtime.state),
      updates: runtime.state.totalUpdates,
    }, 0);
  },
  async step(runtime, ctx) {
    stepAxelrod(runtime.state);
    runtime.stepCount += 1;
    const time = runtime.stepCount;

    await ctx.setTime(time);
    await ctx.syncItems('main', CULTURE_LAYER, createCultureAgents(runtime.state, runtime.config));
    await ctx.setChartValues({
      cultures: countCultures(runtime.state),
      updates: runtime.state.totalUpdates,
    }, time);

    return true;
  },
  async reset(runtime, ctx) {
    runtime.state = initializeAxelrod(runtime.config);
    runtime.stepCount = 0;
    await ctx.sync();
    await ctx.clearAllCharts();
  },
});