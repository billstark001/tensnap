import { compile, type JSExprNode } from 'pure-expr';
import { AgentStorage } from '../environment/storages/AgentStorage';
import type { AgentId } from '@tensnap/protocol/layers';
import type { Scenario } from '../scenario';

export const MAX_STOP_EXPRESSION_SOURCE_LENGTH = 2 * 1024;
export const MAX_STOP_EXPRESSION_AST_NODES = 256;
export const MAX_STOP_EXPRESSION_AST_DEPTH = 32;
export const MAX_STOP_EXPRESSION_STEPS = 10_000;

export interface RunConditionScope {
  readonly steps: number;
  readonly time: number | undefined;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly charts: Readonly<Record<string, unknown>>;
  agent(environmentId: string, layerId: string, id: string | number): Readonly<Record<string, unknown>> | undefined;
  agentCount(environmentId: string, layerId: string): number;
}

export interface CompiledRunCondition {
  readonly source: string;
  evaluate(scope: RunConditionScope): unknown;
}

const cloneReadonly = <T>(value: T): T => structuredClone(value);

type CachedConditionViews = {
  metadataRevision: number;
  metadata: Readonly<Record<string, unknown>>;
  parameterRevision: number;
  parameters: Readonly<Record<string, unknown>>;
  chartRevision: number;
  charts: Readonly<Record<string, unknown>>;
};

const conditionViews = new WeakMap<Scenario, CachedConditionViews>();

const isNode = (value: unknown): value is JSExprNode => (
  typeof value === 'object'
  && value !== null
  && 'type' in value
  && typeof (value as { type?: unknown }).type === 'string'
);

/**
 * pure-expr supports substantially more expression syntax than a run stop
 * condition needs. Keep the public grammar deliberately small and make
 * `agent()` / `agentCount()` the only callable capabilities.
 */
function validateConditionAst(node: JSExprNode): void {
  if (
    node.type === 'regex'
    || node.type === 'arrow-function'
    || node.type === 'template'
    || node.type === 'pipeline'
    || node.type === 'sequence'
    || node.type === 'topic'
    || node.type === 'spread'
  ) {
    throw new Error(`Unsupported stop expression syntax: ${node.type}.`);
  }

  if (node.type === 'call') {
    if (
      node.callee.type !== 'identifier'
      || (node.callee.name !== 'agent' && node.callee.name !== 'agentCount')
    ) {
      throw new Error('Only agent(...) and agentCount(...) calls are allowed in stop expressions.');
    }
  }

  if (
    node.type === 'binary'
    && ['=', '+=', '-=', '*=', '/=', '%=', '**=', '&&=', '||=', '??='].includes(node.operator)
  ) {
    throw new Error('Assignment is not allowed in stop expressions.');
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) validateConditionAst(item);
        if (item && typeof item === 'object' && !isNode(item)) {
          for (const nested of Object.values(item)) {
            if (isNode(nested)) validateConditionAst(nested);
          }
        }
      }
    } else if (isNode(value)) {
      validateConditionAst(value);
    }
  }
}

export function compileRunCondition(source: string): CompiledRunCondition {
  if (!source.trim()) {
    throw new Error('A stop expression must not be empty.');
  }

  const allowedCalls = new Set<CallableFunction>();
  const compiled = compile(source, {
    allowAwait: false,
    allowArrowFunctions: false,
    allowCalls: true,
    allowRegexLiterals: false,
    allowTemplateLiterals: false,
    allowTaggedTemplates: false,
    maxSourceLength: MAX_STOP_EXPRESSION_SOURCE_LENGTH,
    maxAstNodes: MAX_STOP_EXPRESSION_AST_NODES,
    maxAstDepth: MAX_STOP_EXPRESSION_AST_DEPTH,
    maxSteps: MAX_STOP_EXPRESSION_STEPS,
    objectLiteralMode: 'safe',
    // The scope is built here from cloned/frozen renderer data and two
    // capability functions. `copy-plain-data-to-null-prototype` cannot carry
    // those functions, while calls remain explicitly permission-gated below.
    rootContextMode: 'allow',
    isCallableAllowed: ({ fn }) => allowedCalls.has(fn),
  });
  validateConditionAst(compiled.ast);

  return {
    source,
    evaluate(scope) {
      allowedCalls.add(scope.agent);
      allowedCalls.add(scope.agentCount);
      try {
        return compiled.evaluate({
          steps: scope.steps,
          time: scope.time,
          metadata: scope.metadata,
          parameters: scope.parameters,
          charts: scope.charts,
          agent: scope.agent,
          agentCount: scope.agentCount,
        });
      } finally {
        allowedCalls.clear();
      }
    },
  };
}

function createParameterView(scenario: Scenario): Readonly<Record<string, unknown>> {
  const values = Object.create(null) as Record<string, unknown>;
  for (const parameter of scenario.parameters.values()) {
    values[parameter.id] = cloneReadonly(parameter.value);
  }
  return Object.freeze(values);
}

function createChartView(scenario: Scenario): Readonly<Record<string, unknown>> {
  const values = Object.create(null) as Record<string, unknown>;
  for (const metadata of scenario.charts.getAllMeta()) {
    const value = scenario.charts.getLatestValue(metadata.id);
    if (value !== undefined) values[metadata.id] = cloneReadonly(value);
  }
  return Object.freeze(values);
}

function getCachedConditionViews(scenario: Scenario): CachedConditionViews {
  const cached = conditionViews.get(scenario);
  const metadataRevision = scenario.metadataRevision;
  const parameterRevision = scenario.parameterRevision;
  const chartRevision = scenario.charts.revision;
  if (
    cached
    && cached.metadataRevision === metadataRevision
    && cached.parameterRevision === parameterRevision
    && cached.chartRevision === chartRevision
  ) {
    return cached;
  }

  const next: CachedConditionViews = {
    metadataRevision,
    metadata: cached?.metadataRevision === metadataRevision
      ? cached.metadata
      : Object.freeze(scenario.metadata),
    parameterRevision,
    parameters: cached?.parameterRevision === parameterRevision
      ? cached.parameters
      : createParameterView(scenario),
    chartRevision,
    charts: cached?.chartRevision === chartRevision
      ? cached.charts
      : createChartView(scenario),
  };
  conditionViews.set(scenario, next);
  return next;
}

function findAgentStorage(
  scenario: Scenario,
  environmentId: string,
  layerId: string,
): AgentStorage | undefined {
  const layer = scenario.getEnvironment(environmentId)?.layers.get(layerId);
  return layer?.storage instanceof AgentStorage ? layer.storage : undefined;
}

/**
 * Build the small, immutable condition view immediately before an evaluation.
 * It intentionally avoids Scenario.dump(): metadata, parameter values and the
 * latest point for each chart are the only copied values, and agent lookup is
 * resolved lazily through the authoritative AgentStorage.
 */
export function createRunConditionScope(scenario: Scenario, steps: number): RunConditionScope {
  const views = getCachedConditionViews(scenario);
  const agent = (environmentId: string, layerId: string, id: string | number) => {
    const value = findAgentStorage(scenario, environmentId, layerId)?.getAgent(id as AgentId);
    return value === undefined ? undefined : Object.freeze(cloneReadonly(value));
  };
  const agentCount = (environmentId: string, layerId: string) => (
    findAgentStorage(scenario, environmentId, layerId)?.getAgentCount() ?? 0
  );

  return Object.freeze({
    steps,
    time: scenario.time,
    metadata: views.metadata,
    parameters: views.parameters,
    charts: views.charts,
    agent,
    agentCount,
  });
}
