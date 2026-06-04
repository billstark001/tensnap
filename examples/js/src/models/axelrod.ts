// ============================================================
// axelrod.ts
// Original Axelrod (1997) Model of Cultural Dissemination
// "The dissemination of culture: A model with local convergence
//  and global polarization" — J. Conflict Resolut. 41, 203–226
// ============================================================

// #region Types

/** Supported interaction neighborhoods for the Axelrod model. */
export type AxelrodNeighborhood = 'von-neumann' | 'moore' | 'extended';

/** Configuration parameters for the Axelrod model */
export interface AxelrodConfig {
  /** Grid width; total agent count = width × height */
  width: number;
  /** Grid height */
  height: number;
  /** n — number of cultural features per agent */
  numFeatures: number;
  /** m — number of possible trait values per feature; traits drawn from [0, m-1] */
  numTraits: number;
  /** Interaction neighborhood. Extended = Moore + four distance-2 cardinal cells. */
  neighborhood?: AxelrodNeighborhood;
  /** Number of asynchronous micro-updates per rendered TenSnap tick. */
  updatesPerTick?: number;
}

/** A single agent on the 2-D torus lattice */
export interface Agent {
  readonly id: number;
  readonly row: number;
  readonly col: number;
  /** Mutable cultural feature vector; each element ∈ [0, numTraits-1] */
  features: number[];
}

/** Complete simulation state */
export interface AxelrodState {
  /** 2-D grid indexed as agents[row][col] */
  agents: Agent[][];
  config: AxelrodConfig;
  /** Cumulative number of successful cultural updates */
  totalUpdates: number;
}

/** Return value of runAxelrod */
export interface AxelrodResult {
  finalState: AxelrodState;
  /** Number of culturally distinct groups at convergence */
  numCultures: number;
  converged: boolean;
  iterations: number;
}

/** Inspection metrics for a live Axelrod state. */
export interface AxelrodMetrics {
  cultures: number;
  regions: number;
  activeEdges: number;
  meanSimilarity: number;
}

// #endregion

// #region Utilities

/**
 * Creates a fast, seeded pseudo-random number generator (Mulberry32).
 * Returns a function producing uniform floats in [0, 1).
 */
export function createRng(seed: number): () => number {
  let s = seed >>> 0;
  return (): number => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Returns a uniformly random integer in [0, max) */
export function randomInt(max: number, rng: () => number): number {
  return Math.floor(rng() * max);
}

/**
 * Returns all 8 Moore-neighborhood coordinates for cell (row, col)
 * on a toroidal lattice of given width and height.
 */
export function getMooreNeighbors(
  row: number,
  col: number,
  width: number,
  height: number
): Array<[number, number]> {
  const coords: Array<[number, number]> = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      coords.push([
        ((row + dr) % height + height) % height,
        ((col + dc) % width + width) % width,
      ]);
    }
  }
  return coords;
}

export function getAxelrodNeighbors(
  row: number,
  col: number,
  width: number,
  height: number,
  neighborhood: AxelrodNeighborhood = 'moore'
): Array<[number, number]> {
  const offsets: Array<[number, number]> = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];

  if (neighborhood === 'moore' || neighborhood === 'extended') {
    offsets.push(
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    );
  }

  if (neighborhood === 'extended') {
    offsets.push(
      [-2, 0],
      [2, 0],
      [0, -2],
      [0, 2],
    );
  }

  return offsets.map(([dr, dc]) => [
    ((row + dr) % height + height) % height,
    ((col + dc) % width + width) % width,
  ]);
}

function normalizeNeighborhood(config: AxelrodConfig): AxelrodNeighborhood {
  return config.neighborhood ?? 'moore';
}

function cultureKey(agent: Agent): string {
  return agent.features.join(',');
}

// #endregion

// #region Initialization

function makeRandomFeatures(n: number, m: number, rng: () => number): number[] {
  return Array.from({ length: n }, () => randomInt(m, rng));
}

/**
 * Creates a fresh Axelrod state with all agent feature vectors
 * uniformly randomized.
 */
export function initializeAxelrod(
  config: AxelrodConfig,
  rng: () => number = Math.random
): AxelrodState {
  const { width, height, numFeatures, numTraits } = config;
  const agents: Agent[][] = Array.from({ length: height }, (_, r) =>
    Array.from({ length: width }, (_, c) => ({
      id: r * width + c,
      row: r,
      col: c,
      features: makeRandomFeatures(numFeatures, numTraits, rng),
    }))
  );
  return { agents, config, totalUpdates: 0 };
}

// #endregion

// #region Core Model

/**
 * Computes cultural similarity between two agents: the fraction of
 * features on which they share the same trait value.
 * Range: [0, 1].
 */
export function computeSimilarity(a: Agent, b: Agent): number {
  let shared = 0;
  for (let l = 0; l < a.features.length; l++) {
    if (a.features[l] === b.features[l]) shared++;
  }
  return shared / a.features.length;
}

/**
 * Performs one asynchronous update step of the Axelrod model:
 *
 *   1. Select a uniformly random focal agent.
 *   2. Select a uniformly random Moore neighbor as interlocutor.
 *   3. With probability = cultural similarity, copy one randomly
 *      chosen differing feature from the interlocutor to the focal agent.
 *
 * @returns true if a cultural update occurred.
 */
export function stepAxelrod(
  state: AxelrodState,
  rng: () => number = Math.random
): boolean {
  const { agents, config } = state;

  // Step 1 — pick focal agent
  const row = randomInt(config.height, rng);
  const col = randomInt(config.width, rng);
  const focal = agents[row][col];

  // Step 2 — pick a random Moore neighbor
  const neighborCoords = getAxelrodNeighbors(
    row,
    col,
    config.width,
    config.height,
    normalizeNeighborhood(config),
  );
  const [nr, nc] = neighborCoords[randomInt(neighborCoords.length, rng)];
  const neighbor = agents[nr][nc];

  // Step 3 — interact with probability = similarity
  const sim = computeSimilarity(focal, neighbor);
  if (sim === 0 || sim === 1) return false; // nothing to exchange or already identical

  if (rng() < sim) {
    const differingIndices = focal.features
      .map((f, i) => (f !== neighbor.features[i] ? i : -1))
      .filter((i) => i !== -1);

    if (differingIndices.length > 0) {
      const idx = differingIndices[randomInt(differingIndices.length, rng)];
      focal.features[idx] = neighbor.features[idx];
      state.totalUpdates++;
      return true;
    }
  }
  return false;
}

// #endregion

// #region Analysis

/** Counts the number of culturally distinct configurations present. */
export function countCultures(state: AxelrodState): number {
  const seen = new Set<string>();
  for (const row of state.agents)
    for (const agent of row)
      seen.add(cultureKey(agent));
  return seen.size;
}

/** Counts connected regions of identical culture under the configured neighborhood. */
export function countCulturalRegions(state: AxelrodState): number {
  const { width, height } = state.config;
  const neighborhood = normalizeNeighborhood(state.config);
  const visited = new Set<number>();
  let regions = 0;

  for (const row of state.agents) {
    for (const agent of row) {
      if (visited.has(agent.id)) continue;
      regions += 1;
      const targetCulture = cultureKey(agent);
      const queue: Agent[] = [agent];
      visited.add(agent.id);

      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const [nr, nc] of getAxelrodNeighbors(current.row, current.col, width, height, neighborhood)) {
          const neighbor = state.agents[nr][nc];
          if (visited.has(neighbor.id) || cultureKey(neighbor) !== targetCulture) continue;
          visited.add(neighbor.id);
          queue.push(neighbor);
        }
      }
    }
  }

  return regions;
}

export function computeAxelrodPairMetrics(state: AxelrodState): {
  activeEdges: number;
  meanSimilarity: number;
} {
  const { width, height } = state.config;
  const neighborhood = normalizeNeighborhood(state.config);
  const seenPairs = new Set<string>();
  let activeEdges = 0;
  let similaritySum = 0;
  let pairCount = 0;

  for (const row of state.agents) {
    for (const agent of row) {
      for (const [nr, nc] of getAxelrodNeighbors(agent.row, agent.col, width, height, neighborhood)) {
        const neighbor = state.agents[nr][nc];
        const a = Math.min(agent.id, neighbor.id);
        const b = Math.max(agent.id, neighbor.id);
        const key = `${a}:${b}`;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);

        const similarity = computeSimilarity(agent, neighbor);
        similaritySum += similarity;
        pairCount += 1;
        if (similarity > 0 && similarity < 1) {
          activeEdges += 1;
        }
      }
    }
  }

  return {
    activeEdges,
    meanSimilarity: pairCount > 0 ? similaritySum / pairCount : 0,
  };
}

export function computeAxelrodMetrics(state: AxelrodState): AxelrodMetrics {
  const pairMetrics = computeAxelrodPairMetrics(state);
  return {
    cultures: countCultures(state),
    regions: countCulturalRegions(state),
    activeEdges: pairMetrics.activeEdges,
    meanSimilarity: pairMetrics.meanSimilarity,
  };
}

// #endregion

// #region Simulation Runner

/**
 * Runs the Axelrod model to convergence or until maxIterations is reached.
 *
 * Convergence is declared when no cultural update occurs over a window of
 * 10 × |A| consecutive attempts (same criterion as Tornberg 2022).
 */
export function runAxelrod(
  config: AxelrodConfig,
  maxIterations = 1_000_000,
  rng: () => number = Math.random
): AxelrodResult {
  const state = initializeAxelrod(config, rng);
  const threshold = 10 * config.width * config.height;

  let stepsWithoutChange = 0;
  let converged = false;
  let i = 0;

  for (; i < maxIterations; i++) {
    if (stepAxelrod(state, rng)) {
      stepsWithoutChange = 0;
    } else {
      if (++stepsWithoutChange >= threshold) {
        converged = true;
        break;
      }
    }
  }

  return { finalState: state, numCultures: countCultures(state), converged, iterations: i };
}

// #endregion
