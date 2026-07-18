import type {
  BenchmarkConfig,
  ExternalBrowserObservation,
  ExternalProcessContext,
} from '@tensnap/benchmark/harness';

interface CanonicalAgent {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly color: string;
  readonly size: number;
}

export interface CanonicalSchellingState {
  readonly agents: readonly CanonicalAgent[];
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as Record<string, unknown>;
}

function finite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be finite.`);
  return value;
}

function canonicalAgent(value: unknown, index: number): CanonicalAgent {
  const agent = record(value, `agents[${index}]`);
  const id = typeof agent.id === 'string' || typeof agent.id === 'number' ? String(agent.id) : '';
  if (!id) throw new Error(`agents[${index}].id must be a string or number.`);
  const color = typeof agent.color === 'string' ? agent.color.toLowerCase() : '';
  if (!color) throw new Error(`agents[${index}].color must be a string.`);
  return {
    id,
    x: finite(agent.x, `agents[${index}].x`),
    y: finite(agent.y, `agents[${index}].y`),
    color,
    size: finite(agent.size, `agents[${index}].size`),
  };
}

function scenarioAgents(value: Record<string, unknown>): unknown[] | undefined {
  if (!Array.isArray(value.environments)) return undefined;
  const environment = value.environments
    .map((entry) => record(entry, 'environment'))
    .find((entry) => entry.id === 'main') ?? record(value.environments[0], 'environment');
  if (!Array.isArray(environment.layers)) throw new Error('TenSnap renderer snapshot has no layers.');
  const layer = environment.layers
    .map((entry) => record(entry, 'layer'))
    .find((entry) => entry.id === 'agents' || entry.layerType === 'agent');
  if (!layer) throw new Error('TenSnap renderer snapshot has no agent layer.');
  const storage = record(layer.storageSnapshot, 'agent storage snapshot');
  if (!Array.isArray(storage.agents)) throw new Error('TenSnap agent storage snapshot has no agents array.');
  return storage.agents;
}

export function canonicalizeSchellingState(value: unknown): CanonicalSchellingState {
  const source = record(value, 'Schelling state');
  const agents = Array.isArray(source.agents) ? source.agents : scenarioAgents(source);
  if (!agents) {
    const preview = JSON.stringify(value);
    throw new Error(`Schelling state has no canonical agents array: ${preview.slice(0, 1_000)}`);
  }
  return {
    agents: agents.map(canonicalAgent).sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function dimension(config: BenchmarkConfig, camel: string, plain: string, fallback: number): number {
  const value = config[camel] ?? config[plain];
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function validateState(state: CanonicalSchellingState, width: number, height: number, label: string): void {
  if (state.agents.length === 0 || state.agents.length > width * height) throw new Error(`${label} has an invalid population.`);
  const ids = new Set<string>();
  const positions = new Set<string>();
  for (const agent of state.agents) {
    if (ids.has(agent.id)) throw new Error(`${label} contains duplicate agent id ${agent.id}.`);
    ids.add(agent.id);
    if (!Number.isInteger(agent.x) || !Number.isInteger(agent.y) || agent.x < 0 || agent.x >= width || agent.y < 0 || agent.y >= height) {
      throw new Error(`${label} agent ${agent.id} is outside the ${width}x${height} grid.`);
    }
    const position = `${agent.x},${agent.y}`;
    if (positions.has(position)) throw new Error(`${label} contains more than one agent at ${position}.`);
    positions.add(position);
    if (agent.size <= 0) throw new Error(`${label} agent ${agent.id} has a non-positive size.`);
  }
}

/**
 * Validate one UI condition locally. Exact cross-condition equality is checked
 * later by the profile's stateEquivalenceGroup using the canonical state hash.
 */
export function validateSchellingObservation(
  config: BenchmarkConfig,
  observation: ExternalBrowserObservation,
  context: ExternalProcessContext,
): { state: CanonicalSchellingState; expectedState: CanonicalSchellingState } {
  const expectedDelta = context.warmupActions + context.measuredActions;
  if (observation.finalRevision - observation.initialRevision !== expectedDelta) {
    throw new Error(`UI revision advanced ${observation.finalRevision - observation.initialRevision}; expected ${expectedDelta}.`);
  }
  const width = dimension(config, 'gridWidth', 'width', 50);
  const height = dimension(config, 'gridHeight', 'height', 50);
  const initial = observation.initialState === null ? null : canonicalizeSchellingState(observation.initialState);
  const final = canonicalizeSchellingState(observation.finalState);
  if (initial) {
    validateState(initial, width, height, 'initial state');
    if (initial.agents.length !== final.agents.length) throw new Error('Schelling population changed during UI actions.');
  }
  validateState(final, width, height, 'final state');
  // Local validation establishes the expected invariant record. A profile may
  // then require exact equality with another renderer for the same model/seed.
  return { state: final, expectedState: final };
}
