import {
  defineCharts,
  defineExample,
  defineEnvironment,
  defineLayer,
  defineParameters,
} from '@tensnap/js/bindings';
import { SchellingConfig, SchellingModel } from '../models/schelling';

const AGENT_LAYER = 'agents';
const GRID_LAYER = 'grid';

export const DEFAULT_SCHELLING_CONFIG: SchellingConfig = {
  gridWidth: 50,
  gridHeight: 50,
  numAgentsType1: 600,
  numAgentsType2: 600,
  similarityThreshold: 0.4,
  moveDistance: 10,
};

function createSchellingParameters(config: SchellingConfig) {
  return defineParameters(
    { id: 'similarityThreshold', type: 'number', label: 'Similarity Threshold', value: config.similarityThreshold, min: 0, max: 1, step: 0.05, allowRuntimeChange: true },
    { id: 'moveDistance', type: 'number', label: 'Move Distance', value: config.moveDistance, min: 1, max: 10, step: 1, allowRuntimeChange: true },
    { id: 'gridWidth', type: 'number', label: 'Grid Width', value: config.gridWidth, min: 10, max: 100, step: 1, allowRuntimeChange: false },
    { id: 'gridHeight', type: 'number', label: 'Grid Height', value: config.gridHeight, min: 10, max: 100, step: 1, allowRuntimeChange: false },
    { id: 'numAgentsType1', type: 'number', label: 'Type 1 Count', value: config.numAgentsType1, min: 10, max: 1000, step: 10, allowRuntimeChange: false },
    { id: 'numAgentsType2', type: 'number', label: 'Type 2 Count', value: config.numAgentsType2, min: 10, max: 1000, step: 10, allowRuntimeChange: false },
  );
}

const SCHELLING_CHARTS = defineCharts(
  { id: 'satisfaction_rate', label: 'Satisfaction Rate', color: '#2f9e44' },
  { id: 'segregation_index', label: 'Segregation Index', color: '#e8590c' },
);

export const SCHELLING_EXAMPLE = defineExample({
  id: 'schelling',
  name: 'Schelling Segregation Model',
  description: 'Local similarity preference causes macro segregation patterns.',
}, {
  defaults: DEFAULT_SCHELLING_CONFIG,
  parameters: createSchellingParameters,
  environments(config) {
    return [
      defineEnvironment({
        id: 'main',
        type: '2d',
        layers: [
          defineLayer({
            layerId: AGENT_LAYER,
            layerType: 'agent',
            data: { width: config.gridWidth, height: config.gridHeight },
          }),
          defineLayer({
            layerId: GRID_LAYER,
            layerType: 'grid',
            data: { width: config.gridWidth, height: config.gridHeight },
          }),
        ],
      }),
    ];
  },
  charts: SCHELLING_CHARTS,
  create(config) {
    return new SchellingModel(config);
  },
  getConfig(model) {
    return model.getConfig();
  },
  init(model) {
    model.initialize();
  },
  dispose(model) {
    model.destroy();
  },
  async sync(model, ctx) {
    await ctx.syncItems('main', AGENT_LAYER, model.getEnvironmentState().agents);

    const stats = model.getStatistics();
    await ctx.setTime(0);
    await ctx.setChartValues({
      satisfaction_rate: stats.satisfactionRate,
      segregation_index: stats.segregationIndex,
    }, 0);
  },
  async onParameterChange(model, payload, ctx) {
    model.updateParameter(payload.id, payload.value);

    const nextValue = model.getConfig()[payload.id as keyof SchellingConfig];
    if (!Object.is(nextValue, payload.value)) {
      await ctx.refreshParameters(payload.id);
    }
  },
  async step(model, ctx) {
    model.step();
    const stats = model.getStatistics();
    await ctx.setTime(stats.timeStep);
    await ctx.syncItems('main', AGENT_LAYER, model.getEnvironmentState().agents);
    await ctx.setChartValues({
      satisfaction_rate: stats.satisfactionRate,
      segregation_index: stats.segregationIndex,
    }, stats.timeStep);
    return true;
  },
  async reset(model, ctx) {
    model.reset();
    await ctx.sync();
    await ctx.clearAllCharts();
  },
});