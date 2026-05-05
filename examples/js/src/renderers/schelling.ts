import {
  defineCharts,
  defineEnvironment,
  defineLayer,
  defineModel,
  defineParameters,
} from '@tensnap/js/bindings';
import type { SimulatorSession } from '@tensnap/js/runtime';
import type { ScenarioDefinition } from '@tensnap/js/scenario';
import { SchellingConfig, SchellingModel } from '../models/schelling';
import { type JsExampleMetadata } from './shared';

const AGENT_LAYER = 'agents';
const GRID_LAYER = 'grid';

export const SCHELLING_METADATA: JsExampleMetadata = {
  id: 'schelling',
  name: 'Schelling Segregation Model',
  description: 'Local similarity preference causes macro segregation patterns.',
};

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

const schellingBinding = defineModel({
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
    await ctx.createItems('main', AGENT_LAYER, model.getEnvironmentState().agents);

    const stats = model.getStatistics();
    await ctx.metadata({ time: 0 });
    await ctx.updateCharts({
      updates: [
        { id: 'satisfaction_rate', value: stats.satisfactionRate, time: 0 },
        { id: 'segregation_index', value: stats.segregationIndex, time: 0 },
      ],
    });
  },
  async onParameterChange(model, payload, ctx) {
    model.updateParameter(payload.id, payload.value);
    await ctx.refreshParameters(payload.id);
  },
  async step(model, ctx) {
    model.step();
    const stats = model.getStatistics();
    await ctx.metadata({ time: stats.timeStep });

    const updates = model.getAgentUpdates(false);
    const create = updates
      .filter((update) => update.operation === 'create')
      .map((update) => update.data);
    const change = updates
      .filter((update) => update.operation === 'update')
      .map((update) => update.data);

    await ctx.createItems('main', AGENT_LAYER, create);
    await ctx.updateItems('main', AGENT_LAYER, change);
    await ctx.updateCharts({
      updates: [
        { id: 'satisfaction_rate', value: stats.satisfactionRate, time: stats.timeStep },
        { id: 'segregation_index', value: stats.segregationIndex, time: stats.timeStep },
      ],
    });
    return true;
  },
  async reset(model, ctx) {
    model.reset();
    await ctx.sync();
    await ctx.clearCharts('satisfaction_rate', 'segregation_index');
  },
});

export function createSchellingScenario(
  config: Partial<SchellingConfig> = {},
): ScenarioDefinition {
  return schellingBinding.createScenario(config);
}

export function createSchellingSession(
  config: Partial<SchellingConfig> = {},
): SimulatorSession {
  return schellingBinding.createSession(config);
}