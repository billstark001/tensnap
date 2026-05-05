// ============================================================
// tornberg.ts
// Tornberg (2022) Partisan-Sorting Extension of the Axelrod Model
// "How digital media drive affective polarization through partisan sorting"
// PNAS 2022 Vol. 119 No. 42 e2207159119
//
// Key departure from the Axelrod baseline:
//   • Each agent carries a fixed partisan attribute S_i (not subject to change).
//   • Absolute similarity weights S_i via parameter c.
//   • A fraction γ of Moore-neighborhood interlocutors is replaced by
//     uniformly random nonlocal agents, modelling digital media reach.
//   • Interlocutor selection uses an urn model with homophily exponent h.
//   • Partisan sorting ψ measures the alignment of dynamic attributes
//     with partisan identity.
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

/** Extended configuration for the Tornberg model */
export interface TornbergConfig extends AxelrodConfig {
  /**
   * k — number of partisan groups.
   * The paper uses k = 2 (bipolarization); k > 2 is supported.
   */
  numPartisans: number;

  /**
   * c — weight of the fixed partisan attribute relative to one
   * dynamic attribute in the similarity formula.
   * Paper default: c = 4.
   */
  partisanWeight: number;

  /**
   * γ (gamma) — fraction of Moore-neighborhood interlocutors replaced
   * by uniformly random nonlocal agents. Range: [0, 1].
   *   γ = 0 → fully local (recovers Axelrod baseline).
   *   γ = 1 → all interlocutors drawn globally at random.
   */
  gamma: number;

  /**
   * h — influence homophily exponent in the urn model.
   * Higher h → agent influenced almost exclusively by its most similar
   * interlocutor.  h = 1 → influence proportional to raw similarity.
   * Paper tests h ∈ {1, 4, 8}.
   */
  homophilyH: number;
}

/**
 * Tornberg agent: base Axelrod agent augmented with a fixed
 * partisan affiliation attribute S_i.
 */
export interface TornbergAgent extends Agent {
  /** S_i — fixed partisan affiliation, integer in [0, numPartisans-1] */
  partisan: number;
}

/** Complete Tornberg simulation state */
export interface TornbergState {
  agents: TornbergAgent[][];
  config: TornbergConfig;
  totalUpdates: number;
}

/** Return value of runTornberg */
export interface TornbergResult {
  finalState: TornbergState;
  /** ψ at convergence — level of partisan sorting */
  sorting: number;
  converged: boolean;
  iterations: number;
}

// #endregion

// #region Initialization

/**
 * Initializes a Tornberg model by delegating grid creation to
 * initializeAxelrod and then augmenting each agent with a uniformly
 * random fixed partisan attribute.
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

  return { agents, config, totalUpdates: 0 };
}

// #endregion

// #region Similarity

/**
 * Absolute similarity δ_ij between two Tornberg agents:
 *
 *   δ_ij = ( c · 𝟙[S_i = S_j]  +  Σ_{l=1}^{n} 𝟙[D_{i,l} = D_{j,l}] )  /  (c + n)
 *
 * The partisan attribute contributes c times as much as any single
 * dynamic attribute. Range: [0, 1].
 *
 * Note: same-party agents can achieve δ = 1; different-party agents are
 * capped at n / (c + n) regardless of dynamic attribute agreement.
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
 * Computes relative influence weights w_ij over an interlocutor set
 * using the urn model (DellaPosta et al. 2015 / Mäs & Flache 2013):
 *
 *   w_ij = δ_ij^h  /  Σ_{l ∈ I} δ_{il}^h
 *
 * If all absolute similarities are zero (can occur at high h for
 * cross-party pairs with no shared attributes), weights fall back to uniform.
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

/**
 * Builds the interlocutor set I for a focal agent.
 *
 * The set starts as the 8 Moore neighbors of the focal cell. A fraction
 * γ of those slots is replaced by agents drawn uniformly at random from
 * the entire network (excluding the focal agent), capturing the reach of
 * digital media beyond local social bubbles.
 *
 * Neighbor coordinates are shuffled before splitting so that the γ
 * replacement is spatially unbiased.
 */
export function buildInterlocutors(
  state: TornbergState,
  focal: TornbergAgent,
  rng: () => number
): TornbergAgent[] {
  const { config } = state;

  // Start from Moore neighborhood and shuffle for unbiased γ-replacement
  const neighborCoords = getMooreNeighbors(
    focal.row, focal.col, config.width, config.height
  );
  for (let i = neighborCoords.length - 1; i > 0; i--) {
    const j = randomInt(i + 1, rng);
    [neighborCoords[i], neighborCoords[j]] = [neighborCoords[j], neighborCoords[i]];
  }

  const numNonlocal = Math.round(config.gamma * neighborCoords.length);
  const numLocal = neighborCoords.length - numNonlocal;

  const interlocutors: TornbergAgent[] = [];

  // Local portion — first numLocal shuffled Moore neighbors
  for (let i = 0; i < numLocal; i++) {
    const [nr, nc] = neighborCoords[i];
    interlocutors.push(state.agents[nr][nc]);
  }

  // Nonlocal portion — uniformly random agents from the full grid
  const totalAgents = config.width * config.height;
  for (let i = 0; i < numNonlocal; i++) {
    let nr: number, nc: number;
    do {
      const flat = randomInt(totalAgents, rng);
      nr = Math.floor(flat / config.width);
      nc = flat % config.width;
    } while (nr === focal.row && nc === focal.col);
    interlocutors.push(state.agents[nr][nc]);
  }

  return interlocutors;
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
  return candidates[candidates.length - 1]; // floating-point edge case
}

// #endregion

// #region Core Model

/**
 * Performs one asynchronous update step of the Tornberg model:
 *
 *   1. Select a uniformly random focal agent.
 *   2. Build interlocutor set I  (local + γ-fraction nonlocal).
 *   3. Compute absolute similarities → relative weights via urn model.
 *   4. Sample one interlocutor proportional to its relative weight w_ij.
 *   5. Copy one randomly chosen differing dynamic attribute to the focal agent.
 *
 * Partisan affiliation S_i is never modified (held fixed throughout).
 *
 * @returns true if a dynamic attribute update occurred.
 */
export function stepTornberg(
  state: TornbergState,
  rng: () => number = Math.random
): boolean {
  const { agents, config } = state;

  // 1 — focal agent
  const row = randomInt(config.height, rng);
  const col = randomInt(config.width, rng);
  const focal = agents[row][col];

  // 2 — interlocutor set
  const interlocutors = buildInterlocutors(state, focal, rng);
  if (interlocutors.length === 0) return false;

  // 3 & 4 — urn-model selection
  const weights = computeRelativeWeights(
    focal, interlocutors, config.partisanWeight, config.homophilyH
  );
  const chosen = weightedSample(interlocutors, weights, rng);

  // 5 — copy one differing dynamic attribute
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
 * Pairwise dynamic similarity d_ij between two agents:
 *
 *   d_ij = Σ_{l=1}^{n} 𝟙[D_{i,l} = D_{j,l}]  /  n
 *
 * Only flexible (dynamic) attributes are considered; partisan affiliation
 * is excluded so that ψ measures emergent alignment rather than forcing it.
 */
export function computeDynamicSimilarity(a: TornbergAgent, b: TornbergAgent): number {
  let shared = 0;
  for (let l = 0; l < a.features.length; l++) {
    if (a.features[l] === b.features[l]) shared++;
  }
  return shared / a.features.length;
}

/**
 * Partisan sorting index ψ (psi):
 *
 *   ψ = E[ d_ij | S_i = S_j ]  −  E[ d_ij | S_i ≠ S_j ]
 *
 *   ψ ≈ 0  → dynamic attributes distributed independently of party membership.
 *   ψ → 1  → each party is internally homogeneous and maximally distinct
 *             from the other (full sorting).
 *
 * Expected value at random initialisation ≈ 0.
 * Complexity: O(|A|²) — acceptable for grids up to ~625 agents.
 */
export function computeSorting(state: TornbergState): number {
  const flat = state.agents.flat() as TornbergAgent[];
  const n = flat.length;

  let samePairSum = 0, samePairCount = 0;
  let diffPairSum = 0, diffPairCount = 0;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = computeDynamicSimilarity(flat[i], flat[j]);
      if (flat[i].partisan === flat[j].partisan) {
        samePairSum += d; samePairCount++;
      } else {
        diffPairSum += d; diffPairCount++;
      }
    }
  }

  const meanSame = samePairCount > 0 ? samePairSum / samePairCount : 0;
  const meanDiff = diffPairCount > 0 ? diffPairSum / diffPairCount : 0;
  return meanSame - meanDiff;
}

// #endregion

// #region Simulation Runner

/**
 * Runs the Tornberg model to convergence or until maxIterations is reached.
 *
 * Convergence criterion (as in the paper): no dynamic attribute update
 * occurs during 10 × |A| consecutive attempts, or the hard cap of
 * 1 000 000 iterations is reached.
 *
 * Typical paper parameters:
 *   width = height = 14  (|A| = 196)
 *   numFeatures = 10,  numTraits = 10
 *   numPartisans = 2,  partisanWeight = 4
 *   gamma ∈ [0, 1],   homophilyH ∈ {1, 4, 8}
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
    } else {
      if (++stepsWithoutChange >= threshold) {
        converged = true;
        break;
      }
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