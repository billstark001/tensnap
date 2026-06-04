import type { GraphAgentState, GraphEdge, GridAgentState } from '@tensnap/core/environment';
import {
  defineCharts,
  defineExample,
  defineEnvironment,
  defineLayer,
  defineParameters,
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
  publishedNetworkEdgeKeys: Set<string>;
}

function createTornbergParameters(config: TornbergConfig) {
  return defineParameters(
    { id: 'width', type: 'number', label: 'Grid Width', value: config.width, min: 10, max: 120, step: 1, allowRuntimeChange: false },
    { id: 'height', type: 'number', label: 'Grid Height', value: config.height, min: 10, max: 120, step: 1, allowRuntimeChange: false },
    { id: 'numFeatures', type: 'number', label: 'Feature Count', value: config.numFeatures, min: 2, max: 20, step: 1, allowRuntimeChange: false },
    { id: 'numTraits', type: 'number', label: 'Trait Count', value: config.numTraits, min: 2, max: 20, step: 1, allowRuntimeChange: false },
    { id: 'numPartisans', type: 'number', label: 'Partisans', value: config.numPartisans, min: 2, max: 6, step: 1, allowRuntimeChange: false },
    { id: 'networkType', type: 'enum', label: 'Network Type', value: config.networkType ?? 'moore', options: ['moore', 'random-regular', 'scale-free', 'connected-caveman'], allowRuntimeChange: false },
    { id: 'partisanWeight', type: 'number', label: 'Partisan Weight', value: config.partisanWeight, min: 0, max: 20, step: 1, allowRuntimeChange: true },
    { id: 'gamma', type: 'number', label: 'Gamma', value: config.gamma, min: 0, max: 1, step: 0.05, allowRuntimeChange: true },
    { id: 'homophilyH', type: 'number', label: 'Homophily Exponent', value: config.homophilyH, min: 1, max: 12, step: 1, allowRuntimeChange: true },
    { id: 'updatesPerTick', type: 'number', label: 'Updates Per Tick', value: config.updatesPerTick ?? 200, min: 1, max: 2000, step: 25, allowRuntimeChange: true },
  );
}

const TORNBERG_CHARTS = defineCharts(
  { id: 'sorting', label: 'Global Sorting Psi', color: '#c92a2a' },
  { id: 'network_sorting', label: 'Network Sorting Psi', color: '#f08c00' },
  { id: 'within_similarity', label: 'Within-party Similarity', color: '#2f9e44' },
  { id: 'between_similarity', label: 'Between-party Similarity', color: '#1971c2' },
  { id: 'cross_party_edges', label: 'Cross-party Edge Fraction', color: '#7048e8' },
  { id: 'average_degree', label: 'Average Degree', color: '#495057' },
  { id: 'updates', label: 'Updates', color: '#087f5b' },
);

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
    icon: 'square' as const,
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

function getNetworkEdgeKey(edge: Pick<GraphEdge, 'source' | 'target'>): string {
  return `${edge.source}:${edge.target}`;
}

async function syncNetworkEdges(
  runtime: TornbergRuntime,
  ctx: {
    createItems<TItem extends object>(envId: string, layerId: string, items: readonly TItem[]): Promise<void>;
    updateItems<TItem extends object>(envId: string, layerId: string, items: readonly TItem[]): Promise<void>;
    deleteItems<TItem extends object>(envId: string, layerId: string, items: readonly TItem[]): Promise<void>;
  },
): Promise<void> {
  const edges = createNetworkEdges(runtime.state);
  const nextKeys = new Set(edges.map(getNetworkEdgeKey));
  const create = edges.filter((edge) => !runtime.publishedNetworkEdgeKeys.has(getNetworkEdgeKey(edge)));
  const update = edges.filter((edge) => runtime.publishedNetworkEdgeKeys.has(getNetworkEdgeKey(edge)));
  const remove = [...runtime.publishedNetworkEdgeKeys]
    .filter((key) => !nextKeys.has(key))
    .map((key) => {
      const [source, target] = key.split(':').map(Number);
      return { source, target };
    });

  await ctx.deleteItems('interaction-network', NETWORK_EDGE_LAYER, remove);
  await ctx.createItems('interaction-network', NETWORK_EDGE_LAYER, create);
  await ctx.updateItems('interaction-network', NETWORK_EDGE_LAYER, update);
  runtime.publishedNetworkEdgeKeys = nextKeys;
}

async function publishTornbergCharts(
  metrics: TornbergMetrics,
  totalUpdates: number,
  time: number,
  ctx: {
    setChartValues(values: Readonly<Record<string, number>>, time?: number): Promise<void>;
  },
): Promise<void> {
  await ctx.setChartValues({
    sorting: Number(metrics.sorting.toFixed(4)),
    network_sorting: Number(metrics.networkSorting.toFixed(4)),
    within_similarity: Number(metrics.withinSimilarity.toFixed(4)),
    between_similarity: Number(metrics.betweenSimilarity.toFixed(4)),
    cross_party_edges: Number(metrics.crossPartyEdgeFraction.toFixed(4)),
    average_degree: Number(metrics.averageDegree.toFixed(2)),
    updates: totalUpdates,
  }, time);
}

function clampRuntimeNumber(id: string, value: number): number | null {
  switch (id) {
    case 'partisanWeight':
      return Math.max(0, Math.min(20, value));
    case 'gamma':
      return Math.max(0, Math.min(1, value));
    case 'homophilyH':
      return Math.max(1, Math.min(12, Math.round(value)));
    case 'updatesPerTick':
      return Math.max(1, Math.floor(value));
    default:
      return null;
  }
}

export const TORNBERG_EXAMPLE = defineExample({
  id: 'tornberg',
  name: 'Tornberg Partisan Sorting',
  description: 'Digital-media reach, homophily, and network topology amplify partisan sorting in cultural space.',
}, {
  defaults: DEFAULT_TORNBERG_CONFIG,
  parameters: createTornbergParameters,
  environments(config) {
    return [
      defineEnvironment({
        id: 'culture-grid',
        type: '2d',
        layers: [
          defineLayer({
            layerId: CULTURE_LAYER,
            layerType: 'agent',
            data: { width: config.width, height: config.height },
          }),
        ],
      }),
      defineEnvironment({
        id: 'interaction-network',
        type: '2d',
        layers: [
          defineLayer({
            layerId: NETWORK_AGENT_LAYER,
            layerType: 'agent',
            data: { coord_offset: 'float', origin_mode: 'center' },
          }),
          defineLayer({
            layerId: NETWORK_EDGE_LAYER,
            layerType: 'edge',
            dependencyLayerIds: { agent: NETWORK_AGENT_LAYER },
            data: {
              link_distance: 2.4,
              charge_strength: -5,
              centering_strength: 0.08,
              collision_radius: 0.75,
            },
          }),
        ],
      }),
    ];
  },
  charts: TORNBERG_CHARTS,
  create(config): TornbergRuntime {
    const state = initializeTornberg(config);
    return {
      config,
      state,
      stepCount: 0,
      lastMetrics: computeTornbergMetrics(state),
      publishedNetworkEdgeKeys: new Set(),
    };
  },
  init(runtime) {
    runtime.state = initializeTornberg(runtime.config);
    runtime.stepCount = 0;
    runtime.lastMetrics = computeTornbergMetrics(runtime.state);
    runtime.publishedNetworkEdgeKeys = new Set();
  },
  async sync(runtime, ctx) {
    await ctx.syncItems('culture-grid', CULTURE_LAYER, createGridAgents(runtime.state));
    await ctx.syncItems('interaction-network', NETWORK_AGENT_LAYER, createNetworkAgents(runtime.state));
    await syncNetworkEdges(runtime, ctx);
    await ctx.setTime(0);
    await publishTornbergCharts(runtime.lastMetrics, runtime.state.totalUpdates, 0, ctx);
  },
  async onParameterChange(runtime, payload, ctx) {
    if (typeof payload.value !== 'number') {
      return;
    }
    const next = clampRuntimeNumber(payload.id, payload.value);
    if (next === null) {
      return;
    }
    switch (payload.id) {
      case 'partisanWeight':
        runtime.config.partisanWeight = next;
        break;
      case 'gamma':
        runtime.config.gamma = next;
        break;
      case 'homophilyH':
        runtime.config.homophilyH = next;
        break;
      case 'updatesPerTick':
        runtime.config.updatesPerTick = next;
        break;
      default:
        return;
    }
    if (!Object.is(next, payload.value)) {
      await ctx.refreshParameters(payload.id);
    }
  },
  async step(runtime, ctx) {
    const updatesPerTick = Math.max(1, Math.floor(runtime.config.updatesPerTick ?? 1));
    for (let i = 0; i < updatesPerTick; i++) {
      stepTornberg(runtime.state);
    }
    runtime.stepCount += 1;
    const time = runtime.stepCount;

    if (time % SORTING_SAMPLE_INTERVAL === 0) {
      runtime.lastMetrics = computeTornbergMetrics(runtime.state);
    }

    await ctx.setTime(time);
    await ctx.syncItems('culture-grid', CULTURE_LAYER, createGridAgents(runtime.state));
    await ctx.syncItems('interaction-network', NETWORK_AGENT_LAYER, createNetworkAgents(runtime.state));
    await publishTornbergCharts(runtime.lastMetrics, runtime.state.totalUpdates, time, ctx);

    return true;
  },
  async reset(runtime, ctx) {
    runtime.state = initializeTornberg(runtime.config);
    runtime.stepCount = 0;
    runtime.lastMetrics = computeTornbergMetrics(runtime.state);
    await ctx.clearAllCharts();
    await ctx.sync();
  },
});
