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
    };
  });
}

const builder = modelBuilder({
  id: 'axelrod',
  name: 'Axelrod Cultural Dissemination',
  description: 'Local interaction drives convergence and global polarization of cultural traits.',
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
    data: (runtime) => ({ width: runtime.config.width, height: runtime.config.height }),
    items: (runtime) => createCultureAgents(runtime.state, runtime.config),
  });

builder
  .chart('cultures', {
    label: 'Culture Count',
    color: '#5f3dc4',
    get: (runtime) => runtime.lastMetrics.cultures,
  })
  .chart('regions', {
    label: 'Cultural Regions',
    color: '#e67700',
    get: (runtime) => runtime.lastMetrics.regions,
  })
  .chart('active_edges', {
    label: 'Active Boundaries',
    color: '#c92a2a',
    get: (runtime) => runtime.lastMetrics.activeEdges,
  })
  .chart('mean_similarity', {
    label: 'Mean Neighbor Similarity',
    color: '#1971c2',
    get: (runtime) => Number(runtime.lastMetrics.meanSimilarity.toFixed(4)),
  })
  .chart('updates', {
    label: 'Successful Updates',
    color: '#087f5b',
    get: (runtime) => runtime.state.totalUpdates,
  });

export const AXELROD_EXAMPLE = builder.build();
