import {
  modelBuilder,
  numberField,
} from '@tensnap/js/bindings';
import { SchellingConfig, SchellingModel } from '../models/schelling';

const AGENT_LAYER = 'agents';
const GRID_LAYER = 'grid';

export const DEFAULT_SCHELLING_CONFIG: SchellingConfig = {
  gridWidth: 50,
  gridHeight: 50,
  similarityThreshold: 0.7,
  density: 0.8,
  balance: 0.5,
};

const builder = modelBuilder({
  id: 'schelling',
  name: 'Schelling Segregation Model',
  description: 'Local similarity preference causes macro segregation patterns.',
  stateSchemaVersion: '1',
}, {
  defaults: DEFAULT_SCHELLING_CONFIG,
  create(config) {
    return new SchellingModel(config);
  },
  init(model) {
    model.initialize();
  },
  step(model) {
    return model.step();
  },
  reset(model) {
    model.reset();
  },
  dispose(model) {
    model.destroy();
  },
  time(model) {
    return model.getStatistics().timeStep;
  },
  getConfig(model) {
    return model.getConfig();
  },
  sceneRestore: {
    mode: 'compose',
    beforeApply(model, payload) {
      if (payload.envs?.some((environment) => environment.layers.some((layer) => layer.layer_id === AGENT_LAYER))) {
        model.prepareRestoredAgents();
      }
    },
    restoreTime(model, time) {
      model.restoreTime(time);
    },
    afterApply(model) {
      model.finishRestoredAgents();
    },
  },
  restoreCheckpoint(model, data) {
    model.restoreCheckpointData(data);
  },
  captureCheckpoint(model) {
    return model.captureCheckpointData();
  },
});

builder.paramsFromConfig<SchellingConfig>({
  get: (model) => model.getConfig(),
  set(model, patch) {
    model.updateConfig(patch);
  },
  fields: {
    gridWidth: numberField({ label: 'Grid Width', integer: true, runtime: false }),
    gridHeight: numberField({ label: 'Grid Height', integer: true, runtime: false }),
    similarityThreshold: numberField({ label: 'Similarity Threshold', min: 0, max: 1, step: 0.05 }),
    density: numberField({ label: 'Density', min: 0, max: 1, step: 0.05, runtime: false }),
    balance: numberField({ label: 'Balance', min: 0, max: 1, step: 0.05, runtime: false }),
  },
});

builder.env('main')
  .agentLayer(AGENT_LAYER, {
    metadata: (model) => {
      const config = model.getConfig();
      return { width: config.gridWidth, height: config.gridHeight };
    },
    items: (model) => model.getEnvironmentState().agents,
    restore: {
      validate(model, layer) {
        model.validateRestoredAgents(layer.items ?? [], layer.metadata);
      },
      itemIds(model) {
        return model.getEnvironmentState().agents.map((agent) => ({ id: agent.id }));
      },
      restoreMetadata(model, metadata) {
        model.restoreGridMetadata(metadata);
      },
      create(model, item) {
        model.restoreAgent(item);
      },
      update(model, _key, item) {
        model.restoreAgent(item);
      },
      delete(model, key) {
        model.deleteRestoredAgent(key);
      },
    },
  })
  .gridLayer(GRID_LAYER, {
    metadata: (model) => {
      const config = model.getConfig();
      return { width: config.gridWidth, height: config.gridHeight };
    },
    restore: {
      restoreMetadata(model, metadata) {
        model.restoreGridMetadata(metadata);
      },
    },
  });

builder
  .chartGroup('segregation', {
    label: 'Segregation',
    series: [
      {
        id: 'satisfaction_rate',
        label: 'Satisfaction Rate',
        color: '#2f9e44',
        get: (model) => model.getStatistics().satisfactionRate,
      },
      {
        id: 'segregation_index',
        label: 'Segregation Index',
        color: '#e8590c',
        get: (model) => model.getStatistics().segregationIndex,
      },
    ],
  })
  .monitor('population', {
    label: 'Population',
    renderHint: 'table',
    get: (model) => {
      const statistics = model.getStatistics();
      return {
        total: statistics.totalAgents,
        satisfied: statistics.satisfiedCount,
        unsatisfied: statistics.totalAgents - statistics.satisfiedCount,
      };
    },
  });

export const SCHELLING_EXAMPLE = builder.build();
