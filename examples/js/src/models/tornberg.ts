// ============================================================
// tornberg.ts
// Tornberg (2022) Partisan-Sorting Extension of the Axelrod Model
// "How digital media drive affective polarization through partisan sorting"
// PNAS 2022 Vol. 119 No. 42 e2207159119
//
// Key departures from the Axelrod baseline:
//   - Each agent carries a fixed partisan attribute S_i.
//   - Absolute similarity weights S_i via parameter c.
//   - A fraction gamma of network-neighborhood interlocutors is replaced by
//     uniformly sampled nonlocal agents, modelling digital media reach.
//   - Interlocutor selection uses an urn model with homophily exponent h.
//   - Partisan sorting psi measures alignment of dynamic attributes with party.
// ============================================================

import {
  Agent,
  AxelrodConfig,
  AxelrodState,
  getMooreNeighbors,
  initializeAxelrod,
  randomInt,
} from './axelrod';

// #region Types

export type TornbergNetworkType =
  | 'moore'
  | 'random-regular'
  | 'scale-free'
  | 'connected-caveman';

/** Extended configuration for the Tornberg model */
export interface TornbergConfig extends AxelrodConfig {
  /**
   * k - number of partisan groups.
   * The paper uses k = 2 (bipolarization); k > 2 is supported.
   */
  numPartisans: number;

  /**
   * c - weight of the fixed partisan attribute relative to one dynamic
   * attribute in the similarity formula. Paper default: c = 4.
   */
  partisanWeight: number;

  /**
   * gamma - fraction of network-neighborhood interlocutors replaced by
   * uniformly sampled nonlocal agents. Range: [0, 1].
   */
  gamma: number;

  /**
   * h - influence homophily exponent in the urn model.
   * Paper tests h in {1, 4, 8}.
   */
  homophilyH: number;

  /** Underlying social-network topology used before gamma replacement. */
  networkType?: TornbergNetworkType;

  /** Number of asynchronous micro-updates per rendered TenSnap tick. */
  updatesPerTick?: number;
}

/**
 * Tornberg agent: base Axelrod agent augmented with a fixed
 * partisan affiliation attribute S_i.
 */
export interface TornbergAgent extends Agent {
  /** S_i - fixed partisan affiliation, integer in [0, numPartisans - 1] */
  partisan: number;
}

export interface TornbergNetworkEdge {
  source: number;
  target: number;
}

export interface TornbergNetwork {
  type: TornbergNetworkType;
  edges: TornbergNetworkEdge[];
  adjacency: number[][];
  positions: Array<{ x: number; y: number }>;
}

/** Complete Tornberg simulation state */
export interface TornbergState {
  agents: TornbergAgent[][];
  agentsById: TornbergAgent[];
  network: TornbergNetwork;
  config: TornbergConfig;
  totalUpdates: number;
}

/** Return value of runTornberg */
export interface TornbergResult {
  finalState: TornbergState;
  /** psi at convergence - level of partisan sorting */
  sorting: number;
  converged: boolean;
  iterations: number;
}

export interface TornbergSortingComponents {
  sorting: number;
  withinSimilarity: number;
  betweenSimilarity: number;
}

export interface TornbergMetrics extends TornbergSortingComponents {
  networkSorting: number;
  networkWithinSimilarity: number;
  networkBetweenSimilarity: number;
  crossPartyEdgeFraction: number;
  averageDegree: number;
}

// #endregion

// #region Network helpers

function normalizeNetworkType(config: TornbergConfig): TornbergNetworkType {
  return config.networkType ?? 'moore';
}

function edgeKey(source: number, target: number): string {
  const a = Math.min(source, target);
  const b = Math.max(source, target);
  return `${a}:${b}`;
}

function addEdge(
  adjacency: Array<Set<number>>,
  edges: TornbergNetworkEdge[],
  seen: Set<string>,
  source: number,
  target: number,
): boolean {
  if (source === target) return false;
  const key = edgeKey(source, target);
  if (seen.has(key)) return false;
  seen.add(key);
  adjacency[source].add(target);
  adjacency[target].add(source);
  edges.push({ source: Math.min(source, target), target: Math.max(source, target) });
  return true;
}

function removeEdge(
  adjacency: Array<Set<number>>,
  seen: Set<string>,
  source: number,
  target: number,
): void {
  adjacency[source].delete(target);
  adjacency[target].delete(source);
  seen.delete(edgeKey(source, target));
}

function shuffle<T>(values: T[], rng: () => number): T[] {
  for (let i = values.length - 1; i > 0; i--) {
    const j = randomInt(i + 1, rng);
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

function createEmptyAdjacency(totalAgents: number): Array<Set<number>> {
  return Array.from({ length: totalAgents }, () => new Set<number>());
}

function finalizeNetwork(
  type: TornbergNetworkType,
  adjacencySets: Array<Set<number>>,
  edges: TornbergNetworkEdge[],
  positions: Array<{ x: number; y: number }>,
): TornbergNetwork {
  return {
    type,
    edges: edges.map((edge) => ({ ...edge })),
    adjacency: adjacencySets.map((neighbors) => [...neighbors]),
    positions,
  };
}

function gridPositions(width: number, height: number): Array<{ x: number; y: number }> {
  return Array.from({ length: width * height }, (_, id) => ({
    x: id % width,
    y: Math.floor(id / width),
  }));
}

function circularPositions(totalAgents: number, radius = Math.max(10, totalAgents / 10)): Array<{ x: number; y: number }> {
  return Array.from({ length: totalAgents }, (_, id) => {
    const angle = (2 * Math.PI * id) / Math.max(1, totalAgents);
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  });
}

function buildMooreNetwork(config: TornbergConfig): TornbergNetwork {
  const { width, height } = config;
  const totalAgents = width * height;
  const adjacency = createEmptyAdjacency(totalAgents);
  const edges: TornbergNetworkEdge[] = [];
  const seen = new Set<string>();

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const source = row * width + col;
      for (const [nr, nc] of getMooreNeighbors(row, col, width, height)) {
        addEdge(adjacency, edges, seen, source, nr * width + nc);
      }
    }
  }

  return finalizeNetwork('moore', adjacency, edges, gridPositions(width, height));
}

function buildRingLatticeNetwork(totalAgents: number, degree: number): {
  adjacency: Array<Set<number>>;
  edges: TornbergNetworkEdge[];
  seen: Set<string>;
} {
  const adjacency = createEmptyAdjacency(totalAgents);
  const edges: TornbergNetworkEdge[] = [];
  const seen = new Set<string>();
  const half = Math.max(1, Math.floor(degree / 2));

  for (let source = 0; source < totalAgents; source++) {
    for (let offset = 1; offset <= half; offset++) {
      addEdge(adjacency, edges, seen, source, (source + offset) % totalAgents);
    }
  }

  return { adjacency, edges, seen };
}

function buildRandomRegularNetwork(config: TornbergConfig, rng: () => number): TornbergNetwork {
  const totalAgents = config.width * config.height;
  let degree = Math.min(8, totalAgents - 1);
  if ((degree * totalAgents) % 2 !== 0) degree -= 1;
  degree = Math.max(2, degree);

  for (let attempt = 0; attempt < 25; attempt++) {
    const adjacency = createEmptyAdjacency(totalAgents);
    const edges: TornbergNetworkEdge[] = [];
    const seen = new Set<string>();
    const stubs = shuffle(
      Array.from({ length: totalAgents * degree }, (_, index) => Math.floor(index / degree)),
      rng,
    );

    let failed = false;
    while (stubs.length > 1) {
      const source = stubs.pop()!;
      let candidateIndex = -1;
      for (let index = stubs.length - 1; index >= 0; index--) {
        const target = stubs[index];
        if (target !== source && !seen.has(edgeKey(source, target))) {
          candidateIndex = index;
          break;
        }
      }
      if (candidateIndex < 0) {
        failed = true;
        break;
      }
      const [target] = stubs.splice(candidateIndex, 1);
      addEdge(adjacency, edges, seen, source, target);
    }

    if (!failed && adjacency.every((neighbors) => neighbors.size === degree)) {
      return finalizeNetwork('random-regular', adjacency, edges, circularPositions(totalAgents));
    }
  }

  const fallback = buildRingLatticeNetwork(totalAgents, degree);
  return finalizeNetwork('random-regular', fallback.adjacency, fallback.edges, circularPositions(totalAgents));
}

function buildScaleFreeNetwork(config: TornbergConfig, rng: () => number): TornbergNetwork {
  const totalAgents = config.width * config.height;
  const attachmentCount = Math.max(1, Math.min(4, totalAgents - 1));
  const adjacency = createEmptyAdjacency(totalAgents);
  const edges: TornbergNetworkEdge[] = [];
  const seen = new Set<string>();
  const pool: number[] = [];
  const seedSize = Math.min(totalAgents, attachmentCount + 1);

  for (let source = 0; source < seedSize; source++) {
    for (let target = source + 1; target < seedSize; target++) {
      if (addEdge(adjacency, edges, seen, source, target)) {
        pool.push(source, target);
      }
    }
  }

  const choosePreferential = (limit: number): number => {
    if (pool.length === 0) return randomInt(limit, rng);
    const candidate = pool[randomInt(pool.length, rng)];
    return candidate < limit ? candidate : randomInt(limit, rng);
  };

  for (let source = seedSize; source < totalAgents; source++) {
    const targets = new Set<number>();
    let safety = 0;
    while (targets.size < Math.min(attachmentCount, source) && safety++ < source * 10) {
      const lastTarget = targets.size > 0 ? [...targets][targets.size - 1] : null;
      const closureCandidates = lastTarget === null
        ? []
        : [...adjacency[lastTarget]].filter((candidate) => candidate < source && candidate !== source);
      const target = closureCandidates.length > 0 && rng() < 0.01
        ? closureCandidates[randomInt(closureCandidates.length, rng)]
        : choosePreferential(source);
      if (target !== source) {
        targets.add(target);
      }
    }

    for (const target of targets) {
      if (addEdge(adjacency, edges, seen, source, target)) {
        pool.push(source, target);
      }
    }
  }

  const radius = Math.max(10, totalAgents / 12);
  const positions = Array.from({ length: totalAgents }, (_, id) => {
    const angle = (2 * Math.PI * id) / Math.max(1, totalAgents);
    const degreeFactor = 1 / Math.max(1, Math.sqrt(adjacency[id].size));
    return {
      x: Math.cos(angle) * radius * (0.35 + degreeFactor),
      y: Math.sin(angle) * radius * (0.35 + degreeFactor),
    };
  });

  return finalizeNetwork('scale-free', adjacency, edges, positions);
}

function buildConnectedCavemanNetwork(config: TornbergConfig, rng: () => number): TornbergNetwork {
  const totalAgents = config.width * config.height;
  const cliqueSize = Math.max(4, Math.round(Math.sqrt(totalAgents)));
  const cliqueCount = Math.ceil(totalAgents / cliqueSize);
  const adjacency = createEmptyAdjacency(totalAgents);
  const edges: TornbergNetworkEdge[] = [];
  const seen = new Set<string>();

  for (let clique = 0; clique < cliqueCount; clique++) {
    const start = clique * cliqueSize;
    const end = Math.min(totalAgents, start + cliqueSize);
    for (let source = start; source < end; source++) {
      for (let target = source + 1; target < end; target++) {
        addEdge(adjacency, edges, seen, source, target);
      }
    }
  }

  const rewiringProbability = 0.05;
  for (const edge of [...edges]) {
    if (rng() >= rewiringProbability) continue;
    const sourceClique = Math.floor(edge.source / cliqueSize);
    const outside = Array.from({ length: totalAgents }, (_, id) => id)
      .filter((candidate) => (
        candidate !== edge.source
        && Math.floor(candidate / cliqueSize) !== sourceClique
        && !seen.has(edgeKey(edge.source, candidate))
      ));
    if (outside.length === 0) continue;

    const target = outside[randomInt(outside.length, rng)];
    removeEdge(adjacency, seen, edge.source, edge.target);
    const index = edges.findIndex((current) => edgeKey(current.source, current.target) === edgeKey(edge.source, edge.target));
    if (index >= 0) edges.splice(index, 1);
    addEdge(adjacency, edges, seen, edge.source, target);
  }

  const positions = Array.from({ length: totalAgents }, (_, id) => {
    const clique = Math.floor(id / cliqueSize);
    const index = id % cliqueSize;
    const cliqueAngle = (2 * Math.PI * clique) / Math.max(1, cliqueCount);
    const innerAngle = (2 * Math.PI * index) / cliqueSize;
    const clusterRadius = Math.max(4, cliqueSize / 3);
    const outerRadius = Math.max(12, cliqueCount * 2.5);
    return {
      x: Math.cos(cliqueAngle) * outerRadius + Math.cos(innerAngle) * clusterRadius,
      y: Math.sin(cliqueAngle) * outerRadius + Math.sin(innerAngle) * clusterRadius,
    };
  });

  return finalizeNetwork('connected-caveman', adjacency, edges, positions);
}

export function buildTornbergNetwork(
  config: TornbergConfig,
  rng: () => number = Math.random,
): TornbergNetwork {
  switch (normalizeNetworkType(config)) {
    case 'random-regular':
      return buildRandomRegularNetwork(config, rng);
    case 'scale-free':
      return buildScaleFreeNetwork(config, rng);
    case 'connected-caveman':
      return buildConnectedCavemanNetwork(config, rng);
    case 'moore':
    default:
      return buildMooreNetwork(config);
  }
}

// #endregion

// #region Initialization

/**
 * Initializes a Tornberg model by delegating grid creation to initializeAxelrod
 * and then augmenting each agent with a uniformly random fixed partisan
 * attribute. The social network is built separately from the display grid so
 * the renderer can inspect both spatial culture and interaction topology.
 */
export function initializeTornberg(
  config: TornbergConfig,
  rng: () => number = Math.random
): TornbergState {
  const base: AxelrodState = initializeAxelrod(config, rng);

  const agents: TornbergAgent[][] = base.agents.map((row) =>
    row.map(
      (agent): TornbergAgent => ({
        ...agent,
        partisan: randomInt(config.numPartisans, rng),
      })
    )
  );
  const agentsById = agents.flat();

  return {
    agents,
    agentsById,
    network: buildTornbergNetwork(config, rng),
    config,
    totalUpdates: 0,
  };
}

// #endregion

// #region Similarity

/**
 * Absolute similarity delta_ij between two Tornberg agents:
 *
 * delta_ij = (c * 1[S_i = S_j] + sum_l 1[D_i,l = D_j,l]) / (c + n)
 *
 * The partisan attribute contributes c times as much as any single dynamic
 * attribute. Partisan affiliation is never copied.
 */
export function computeAbsoluteSimilarity(
  a: TornbergAgent,
  b: TornbergAgent,
  c: number
): number {
  const n = a.features.length;
  const partisanScore = a.partisan === b.partisan ? c : 0;
  let dynamicScore = 0;
  for (let l = 0; l < n; l++) {
    if (a.features[l] === b.features[l]) dynamicScore++;
  }
  return (partisanScore + dynamicScore) / (c + n);
}

/**
 * Computes relative influence weights w_ij over an interlocutor set using the
 * urn model: w_ij = delta_ij^h / sum_l delta_il^h.
 */
export function computeRelativeWeights(
  focal: TornbergAgent,
  interlocutors: TornbergAgent[],
  c: number,
  h: number
): number[] {
  const powered = interlocutors.map((b) =>
    Math.pow(computeAbsoluteSimilarity(focal, b, c), h)
  );
  const total = powered.reduce((s, v) => s + v, 0);

  if (total === 0) {
    const uniform = 1 / interlocutors.length;
    return interlocutors.map(() => uniform);
  }
  return powered.map((v) => v / total);
}

// #endregion

// #region Interlocutors

function sampleAgentIds(
  totalAgents: number,
  count: number,
  rng: () => number,
): number[] {
  const ids = Array.from({ length: totalAgents }, (_, id) => id);
  shuffle(ids, rng);
  return ids.slice(0, Math.min(count, totalAgents));
}

/**
 * Builds the interlocutor set I for a focal agent.
 *
 * The set starts from the focal node's network neighbors. A fraction gamma of
 * those slots is replaced by uniformly sampled agents from the whole network,
 * matching the mechanism used by the paper's reference implementation.
 */
export function buildInterlocutors(
  state: TornbergState,
  focal: TornbergAgent,
  rng: () => number
): TornbergAgent[] {
  const neighborIds = [...(state.network.adjacency[focal.id] ?? [])];
  if (neighborIds.length === 0) return [];

  shuffle(neighborIds, rng);
  const numNonlocal = Math.floor(Math.max(0, Math.min(1, state.config.gamma)) * neighborIds.length);
  const numLocal = neighborIds.length - numNonlocal;
  const localIds = neighborIds.slice(0, numLocal);
  const nonlocalIds = sampleAgentIds(state.agentsById.length, numNonlocal, rng);

  return [...localIds, ...nonlocalIds]
    .map((id) => state.agentsById[id])
    .filter((agent): agent is TornbergAgent => Boolean(agent));
}

/**
 * Samples one agent from a list according to a discrete probability
 * distribution (cumulative sum walk).
 */
export function weightedSample(
  candidates: TornbergAgent[],
  weights: number[],
  rng: () => number
): TornbergAgent {
  const r = rng();
  let cumulative = 0;
  for (let i = 0; i < candidates.length; i++) {
    cumulative += weights[i];
    if (r < cumulative) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

// #endregion

// #region Core Model

/**
 * Performs one asynchronous update step of the Tornberg model.
 *
 * Partisan affiliation S_i is fixed; only dynamic Axelrod-style attributes are
 * copied.
 *
 * @returns true if a dynamic attribute update occurred.
 */
export function stepTornberg(
  state: TornbergState,
  rng: () => number = Math.random
): boolean {
  const { config } = state;
  const focal = state.agentsById[randomInt(state.agentsById.length, rng)];

  const interlocutors = buildInterlocutors(state, focal, rng);
  if (interlocutors.length === 0) return false;

  const weights = computeRelativeWeights(
    focal,
    interlocutors,
    config.partisanWeight,
    config.homophilyH,
  );
  const chosen = weightedSample(interlocutors, weights, rng);

  const differingIndices = focal.features
    .map((f, i) => (f !== chosen.features[i] ? i : -1))
    .filter((i) => i !== -1);

  if (differingIndices.length > 0) {
    const idx = differingIndices[randomInt(differingIndices.length, rng)];
    focal.features[idx] = chosen.features[idx];
    state.totalUpdates++;
    return true;
  }
  return false;
}

// #endregion

// #region Sorting Metric

/**
 * Pairwise dynamic similarity d_ij between two agents.
 * Only flexible attributes are considered; partisan affiliation is excluded.
 */
export function computeDynamicSimilarity(a: TornbergAgent, b: TornbergAgent): number {
  let shared = 0;
  for (let l = 0; l < a.features.length; l++) {
    if (a.features[l] === b.features[l]) shared++;
  }
  return shared / a.features.length;
}

function computeSortingFromPairs(
  pairs: Array<[TornbergAgent, TornbergAgent]>,
): TornbergSortingComponents {
  let samePairSum = 0, samePairCount = 0;
  let diffPairSum = 0, diffPairCount = 0;

  for (const [a, b] of pairs) {
    const d = computeDynamicSimilarity(a, b);
    if (a.partisan === b.partisan) {
      samePairSum += d; samePairCount++;
    } else {
      diffPairSum += d; diffPairCount++;
    }
  }

  const withinSimilarity = samePairCount > 0 ? samePairSum / samePairCount : 0;
  const betweenSimilarity = diffPairCount > 0 ? diffPairSum / diffPairCount : 0;
  return {
    sorting: withinSimilarity - betweenSimilarity,
    withinSimilarity,
    betweenSimilarity,
  };
}

export function computeSortingComponents(state: TornbergState): TornbergSortingComponents {
  const pairs: Array<[TornbergAgent, TornbergAgent]> = [];
  for (let i = 0; i < state.agentsById.length; i++) {
    for (let j = i + 1; j < state.agentsById.length; j++) {
      pairs.push([state.agentsById[i], state.agentsById[j]]);
    }
  }
  return computeSortingFromPairs(pairs);
}

export function computeNetworkSortingComponents(state: TornbergState): TornbergSortingComponents {
  return computeSortingFromPairs(
    state.network.edges.map((edge) => [
      state.agentsById[edge.source],
      state.agentsById[edge.target],
    ]),
  );
}

/**
 * Partisan sorting index psi:
 *
 * psi = E[d_ij | S_i = S_j] - E[d_ij | S_i != S_j]
 */
export function computeSorting(state: TornbergState): number {
  return computeSortingComponents(state).sorting;
}

export function computeTornbergMetrics(state: TornbergState): TornbergMetrics {
  const global = computeSortingComponents(state);
  const network = computeNetworkSortingComponents(state);
  const crossPartyEdges = state.network.edges.filter((edge) => (
    state.agentsById[edge.source]?.partisan !== state.agentsById[edge.target]?.partisan
  )).length;

  return {
    ...global,
    networkSorting: network.sorting,
    networkWithinSimilarity: network.withinSimilarity,
    networkBetweenSimilarity: network.betweenSimilarity,
    crossPartyEdgeFraction: state.network.edges.length > 0 ? crossPartyEdges / state.network.edges.length : 0,
    averageDegree: state.agentsById.length > 0 ? (2 * state.network.edges.length) / state.agentsById.length : 0,
  };
}

// #endregion

// #region Simulation Runner

/**
 * Runs the Tornberg model to convergence or until maxIterations is reached.
 *
 * Convergence criterion: no dynamic attribute update occurs during
 * 10 * |A| consecutive attempts, or the hard cap is reached.
 */
export function runTornberg(
  config: TornbergConfig,
  maxIterations = 1_000_000,
  rng: () => number = Math.random
): TornbergResult {
  const state = initializeTornberg(config, rng);
  const threshold = 10 * config.width * config.height;

  let stepsWithoutChange = 0;
  let converged = false;
  let i = 0;

  for (; i < maxIterations; i++) {
    if (stepTornberg(state, rng)) {
      stepsWithoutChange = 0;
    } else if (++stepsWithoutChange >= threshold) {
      converged = true;
      break;
    }
  }

  return {
    finalState: state,
    sorting: computeSorting(state),
    converged,
    iterations: i,
  };
}

// #endregion
