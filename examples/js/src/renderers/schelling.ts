import { modelBuilder, numberField } from '@tensnap/js/bindings';
import {
  DEFAULT_SCHELLING_CONFIG,
  SchellingModel,
  type SchellingConfig,
} from '../models/schelling';

const AGENT_LAYER = 'agents';
const GRID_LAYER = 'grid';

export { DEFAULT_SCHELLING_CONFIG };

/** Optional model observer belongs to this definition, never module-global state. */
export function createSchellingExample(observe?: (model: SchellingModel) => void) {
  const builder = modelBuilder(
    {
      id: 'schelling',
      name: 'Schelling Segregation Model',
      description: 'Local similarity preference causes macro segregation patterns.',
      stateSchemaVersion: '3',
    },
    {
      defaults: DEFAULT_SCHELLING_CONFIG,
      create(config) {
        return new SchellingModel(config);
      },
      init(model) {
        model.initialize();
        observe?.(model);
      },
      step(model) {
        const advanced = model.step();
        observe?.(model);
        return advanced;
      },
      reset(model) {
        model.reset();
        observe?.(model);
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
          if (
            payload.envs?.some((environment) =>
              environment.layers.some((layer) => layer.layer_id === AGENT_LAYER),
            )
          ) {
            model.prepareRestoredAgents();
          }
        },
        restoreTime(model, time) {
          model.restoreTime(time);
        },
        afterApply(model, payload) {
          if (
            payload.envs?.some((environment) =>
              environment.layers.some(
                (layer) => layer.layer_id === AGENT_LAYER || layer.layer_id === GRID_LAYER,
              ),
            )
          ) {
            model.finishRestoredAgents();
          }
        },
      },
      restoreCheckpoint(model, data) {
        model.restoreCheckpointData(data);
        observe?.(model);
      },
      captureCheckpoint(model) {
        return model.captureCheckpointData();
      },
    },
  );

  builder.paramsFromConfig<SchellingConfig>({
    get: (model) => model.getConfig(),
    set(model, patch) {
      model.updateConfig(patch);
      observe?.(model);
    },
    fields: {
      seed: numberField({
        label: 'Seed (next reset)',
        min: 0,
        max: 0xffffffff,
        integer: true,
        runtime: false,
      }),
      gridWidth: numberField({ label: 'Grid Width', integer: true, runtime: false }),
      gridHeight: numberField({ label: 'Grid Height', integer: true, runtime: false }),
      similarityThreshold: numberField({
        label: 'Similarity Threshold',
        min: 0,
        max: 1,
        step: 0.05,
      }),
      density: numberField({ label: 'Density', min: 0, max: 1, step: 0.05, runtime: false }),
      balance: numberField({ label: 'Balance', min: 0, max: 1, step: 0.05, runtime: false }),
    },
  });

  builder
    .env('main')
    .agentLayer(AGENT_LAYER, {
      metadata: (model) => {
        const config = model.getConfig();
        return { width: config.gridWidth, height: config.gridHeight };
      },
      items: (model) => model.getEnvironmentState().agents,
      updates: (model) => model.takeAgentUpdates(),
      restore: {
        validate(model, layer) {
          model.validateRestoredAgents(layer.items ?? [], layer.metadata);
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

  return builder.build();
}

export const SCHELLING_EXAMPLE = createSchellingExample();
