import type { GraphAgentState, GraphEdge, GridAgentState } from '@tensnap/core/environment';
import {
  enumField,
  modelBuilder,
  numberField,
} from '@tensnap/js/bindings';
import {
  TornbergConfig,
  TornbergMetrics,
  TornbergState,
  computeTornbergMetrics,
  initializeTornberg,
  stepTornberg,
} from '../models/tornberg';

const CULTURE_LAYER = 'culture';
const NETWORK_AGENT_LAYER = 'network_agents';
const NETWORK_EDGE_LAYER = 'network_edges';
const SORTING_SAMPLE_INTERVAL = 5;

export const DEFAULT_TORNBERG_CONFIG: TornbergConfig = {
  width: 25,
  height: 25,
  numFeatures: 10,
  numTraits: 10,
  numPartisans: 2,
  partisanWeight: 4,
  gamma: 0.25,
  homophilyH: 8,
  networkType: 'moore',
  updatesPerTick: 200,
};

interface TornbergRuntime {
  config: TornbergConfig;
  state: TornbergState;
  stepCount: number;
  lastMetrics: TornbergMetrics;
}

function createCultureColor(agent: { features: number[] }, numTraits: number): string {
  const max = Math.max(1, numTraits - 1);
  const [f0 = 0, f1 = 0, f2 = 0] = agent.features;
  const r = Math.round((f0 / max) * 255);
  const g = Math.round((f1 / max) * 255);
  const b = Math.round((f2 / max) * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

function getPartisanIcon(partisan: number): GraphAgentState['icon'] {
  const icons: Array<NonNullable<GraphAgentState['icon']>> = [
    'circle',
    'cross',
    'triangle',
    'diamond',
    'hexagon',
    'star',
  ];
  return icons[partisan % icons.length];
}

function createGridAgents(state: TornbergState): GridAgentState[] {
  return state.agentsById.map((agent) => ({
    id: `g_${agent.id}`,
    x: agent.col,
    y: agent.row,
    heading: 0,
    icon: 'square',
    size: 0.92,
    color: createCultureColor(agent, state.config.numTraits),
    data: {
      partisan: agent.partisan,
      culture: agent.features.join(','),
    },
  }));
}

function createNetworkAgents(state: TornbergState): GraphAgentState[] {
  return state.agentsById.map((agent) => {
    const position = state.network.positions[agent.id] ?? { x: agent.col, y: agent.row };
    return {
      id: agent.id,
      x: position.x,
      y: position.y,
      icon: getPartisanIcon(agent.partisan),
      size: 1,
      color: createCultureColor(agent, state.config.numTraits),
      data: {
        partisan: agent.partisan,
        culture: agent.features.join(','),
        degree: state.network.adjacency[agent.id]?.length ?? 0,
      },
    };
  });
}

function createNetworkEdges(state: TornbergState): GraphEdge[] {
  return state.network.edges.map((edge) => {
    const source = state.agentsById[edge.source];
    const target = state.agentsById[edge.target];
    const crossParty = source?.partisan !== target?.partisan;
    return {
      source: edge.source,
      target: edge.target,
      color: crossParty ? '#d9480f' : '#868e96',
      width: crossParty ? 0.06 : 0.035,
    };
  });
}

const builder = modelBuilder({
  id: 'tornberg',
  name: 'Tornberg Partisan Sorting',
  description: 'Digital-media reach, homophily, and network topology amplify partisan sorting in cultural space.',
}, {
  defaults: DEFAULT_TORNBERG_CONFIG,
  create(config): TornbergRuntime {
    const state = initializeTornberg(config);
    return {
      config: { ...config },
      state,
      stepCount: 0,
      lastMetrics: computeTornbergMetrics(state),
    };
  },
  init(runtime) {
    runtime.state = initializeTornberg(runtime.config);
    runtime.stepCount = 0;
    runtime.lastMetrics = computeTornbergMetrics(runtime.state);
  },
  step(runtime) {
    const updatesPerTick = Math.max(1, Math.floor(runtime.config.updatesPerTick ?? 1));
    for (let i = 0; i < updatesPerTick; i++) {
      stepTornberg(runtime.state);
    }
    runtime.stepCount += 1;
    if (runtime.stepCount % SORTING_SAMPLE_INTERVAL === 0) {
      runtime.lastMetrics = computeTornbergMetrics(runtime.state);
    }
    return true;
  },
  reset(runtime) {
    runtime.state = initializeTornberg(runtime.config);
    runtime.stepCount = 0;
    runtime.lastMetrics = computeTornbergMetrics(runtime.state);
  },
  time(runtime) {
    return runtime.stepCount;
  },
  getConfig(runtime) {
    return runtime.config;
  },
});

builder.paramsFromConfig<TornbergConfig>({
  get: (runtime) => runtime.config,
  set(runtime, patch) {
    Object.assign(runtime.config, patch);
  },
  fields: {
    width: numberField({ label: 'Grid Width', integer: true, runtime: false }),
    height: numberField({ label: 'Grid Height', integer: true, runtime: false }),
    numFeatures: numberField({ label: 'Feature Count', integer: true, runtime: false }),
    numTraits: numberField({ label: 'Trait Count', integer: true, runtime: false }),
    numPartisans: numberField({ label: 'Partisans', integer: true, runtime: false }),
    networkType: enumField({
      label: 'Network Type',
      options: ['moore', 'random-regular', 'scale-free', 'connected-caveman'],
      runtime: false,
    }),
    partisanWeight: numberField({ label: 'Partisan Weight', min: 0, max: 20, integer: true }),
    gamma: numberField({ label: 'Gamma', min: 0, max: 1, step: 0.05 }),
    homophilyH: numberField({ label: 'Homophily Exponent', min: 1, max: 12, integer: true }),
    updatesPerTick: numberField({ label: 'Updates Per Tick', min: 1, step: 25, integer: true }),
  },
});

builder.env('culture-grid')
  .agentLayer(CULTURE_LAYER, {
    data: (runtime) => ({ width: runtime.config.width, height: runtime.config.height }),
    items: (runtime) => createGridAgents(runtime.state),
  });

builder.env('interaction-network')
  .agentLayer(NETWORK_AGENT_LAYER, {
    data: { coord_offset: 'float', origin_mode: 'center' },
    items: (runtime) => createNetworkAgents(runtime.state),
  })
  .edgeLayer(NETWORK_EDGE_LAYER, {
    dependencyLayerIds: { agent: NETWORK_AGENT_LAYER },
    data: {
      link_distance: 2.4,
      charge_strength: -5,
      centering_strength: 0.08,
      collision_radius: 0.75,
    },
    items: (runtime) => createNetworkEdges(runtime.state),
    key: ['source', 'target'],
  });

builder
  .chart('sorting', {
    label: 'Global Sorting Psi',
    color: '#c92a2a',
    get: (runtime) => Number(runtime.lastMetrics.sorting.toFixed(4)),
  })
  .chart('network_sorting', {
    label: 'Network Sorting Psi',
    color: '#f08c00',
    get: (runtime) => Number(runtime.lastMetrics.networkSorting.toFixed(4)),
  })
  .chart('within_similarity', {
    label: 'Within-party Similarity',
    color: '#2f9e44',
    get: (runtime) => Number(runtime.lastMetrics.withinSimilarity.toFixed(4)),
  })
  .chart('between_similarity', {
    label: 'Between-party Similarity',
    color: '#1971c2',
    get: (runtime) => Number(runtime.lastMetrics.betweenSimilarity.toFixed(4)),
  })
  .chart('cross_party_edges', {
    label: 'Cross-party Edge Fraction',
    color: '#7048e8',
    get: (runtime) => Number(runtime.lastMetrics.crossPartyEdgeFraction.toFixed(4)),
  })
  .chart('average_degree', {
    label: 'Average Degree',
    color: '#495057',
    get: (runtime) => Number(runtime.lastMetrics.averageDegree.toFixed(2)),
  })
  .chart('updates', {
    label: 'Updates',
    color: '#087f5b',
    get: (runtime) => runtime.state.totalUpdates,
  });

export const TORNBERG_EXAMPLE = builder.build();
