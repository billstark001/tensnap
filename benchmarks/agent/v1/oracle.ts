import { createHash } from 'node:crypto';
import type {
  ScenarioSnapshot,
  ScenarioQuery,
  ScenarioQueryResult,
} from '../../../packages/core/src/scenario';
import { SchellingModel } from '../../../examples/js/src/models/schelling';
import { expectedState, resolveConfig as walkConfig } from '../../v0.3/random-walk/model';
import type { AgentBenchmarkConfig } from './benchmark';

export interface Point {
  id: string | number;
  x: number;
  y: number;
}
export function digest(value: unknown): string {
  const stable = (input: unknown): unknown =>
    Array.isArray(input)
      ? input.map(stable)
      : input && typeof input === 'object'
        ? Object.fromEntries(
            Object.entries(input)
              .filter(([, v]) => v !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k, stable(v)]),
          )
        : input;
  return createHash('sha256')
    .update(JSON.stringify(stable(value)))
    .digest('hex');
}
export function points(scene: ScenarioSnapshot): Point[] {
  const layer = scene.environments
    .find((e) => e.id === 'main')
    ?.layers.find((l) => l.id === 'agents');
  if (!layer) throw new Error('Missing main/agents projection.');
  return (layer.storageSnapshot as { agents: Point[] }).agents.map(({ id, x, y }) => ({
    id,
    x,
    y,
  }));
}
export function pointHash(agents: Point[]): string {
  const key = (p: Point) => JSON.stringify([typeof p.id, p.id]);
  const ids = new Set<string>();
  for (const point of agents) {
    if (
      (typeof point.id !== 'string' && typeof point.id !== 'number') ||
      (typeof point.id === 'number' && !Number.isFinite(point.id)) ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      ids.has(key(point))
    )
      throw new Error('Invalid or duplicate projected agent identity/coordinates.');
    ids.add(key(point));
  }
  return digest([...agents].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)));
}
export function reference(config: AgentBenchmarkConfig, time: number) {
  if (config.case === 'collection') {
    const expected = expectedState(
      walkConfig({
        agentCount: config.agentCount,
        changedAgents: config.changedAgents,
        seed: config.seed,
      }),
      time,
    ) as { agents: Point[] };
    return { agents: expected.agents, population: undefined };
  }
  const model = new SchellingModel({
    gridWidth: config.gridSize,
    gridHeight: config.gridSize,
    density: 0.8,
    balance: 0.5,
    similarityThreshold: 0.8,
    seed: config.seed,
  });
  model.initialize();
  for (let i = 0; i < time; i++) model.step();
  const stats = model.getStatistics();
  return {
    agents: model.getEnvironmentState().agents.map(({ id, x, y }) => ({ id, x: x!, y: y! })),
    population: {
      total: stats.totalAgents,
      satisfied: stats.satisfiedCount,
      unsatisfied: stats.totalAgents - stats.satisfiedCount,
    },
  };
}
export function queryFor(
  kind: AgentBenchmarkConfig['query'],
  agents: Point[],
): ScenarioQuery | undefined {
  const agent = agents[0]!;
  const ref = { environmentId: 'main', layerId: 'agents', agentId: agent.id };
  const fields = ['/id', '/x', '/y'];
  if (kind === 'snapshot') return undefined;
  if (kind === 'monitor')
    return { selector: { kind: 'monitor', id: 'population' }, fields: ['/value/total'], limit: 1 };
  if (kind === 'cell')
    return {
      selector: { kind: 'cell', environmentId: 'main', layerId: 'agents', x: agent.x, y: agent.y },
      fields,
      limit: 1,
    };
  return {
    selector: kind === 'agent' ? { kind, ref } : { kind, ref, radius: 3 },
    fields,
    limit: 8,
  };
}
export function queryProof(result: ScenarioQueryResult) {
  return {
    version: result.version,
    time: result.location.modelTime,
    found: result.found,
    count: result.count,
    truncated: result.truncated,
    hasCursor: result.cursor !== undefined,
    items: result.items,
  };
}
/** Independent plain-array scan, with no production query engine or renderer state. */
export function expectedQuery(
  kind: AgentBenchmarkConfig['query'],
  expected: ReturnType<typeof reference>,
  time: number,
) {
  const target = expected.agents[0]!;
  const selected =
    kind === 'monitor'
      ? []
      : kind === 'agent'
        ? [target]
        : expected.agents.filter((p) =>
            kind === 'cell'
              ? p.x === target.x && p.y === target.y
              : p.id !== target.id && Math.hypot(p.x - target.x, p.y - target.y) <= 3,
          );
  const limit = kind === 'cell' || kind === 'monitor' ? 1 : 8;
  const items =
    kind === 'monitor'
      ? [
          {
            ref: { kind: 'monitor', id: 'population' },
            fields: [{ path: ['value', 'total'], found: true, value: expected.population!.total }],
          },
        ]
      : selected.slice(0, limit).map((p) => ({
          ref: { kind: 'agent', environmentId: 'main', layerId: 'agents', agentId: p.id },
          fields: ['id', 'x', 'y'].map((key) => ({
            path: [key],
            found: true,
            value: p[key as keyof Point],
          })),
        }));
  const truncated = selected.length > limit;
  return {
    version: 1,
    time,
    found: items.length > 0,
    count: items.length,
    truncated,
    hasCursor: truncated,
    items,
  };
}
