import {
  Agent, AgentId, 
  AgentTrajectoryPoint, 
  Environment, EnvironmentId, EnvironmentType, GraphAgent, GridAgent,
  PureEnvironment, PureGraphEnvironment, PureGridEnvironment, PureUniformEnvironment,
  UniformAgent
  } from "../../types/model";

/**
 * Represents a single protocol layer within an instantiated environment.
 * Tracks the layer type string, its current metadata, and optionally
 * per-layer entity collections for agent/edge layers.
 */
export interface InstantiatedLayer {
  /** Registered layer_type string (e.g. "agent", "edge", "grid", "background"). */
  layer_type: string;
  /** Layer metadata as received via env_layer_create / env_layer_update. */
  data: Record<string, any>;
}

export interface InstantiatedEnvironment {
  id: EnvironmentId;
  type: EnvironmentType;
  label: string;
  props: PureEnvironment;
  agents: Record<AgentId, Agent>;
  /**
   * Per-protocol-layer registry: layer_id → InstantiatedLayer.
   * Populated by createEnvLayer / updateEnvLayer / deleteEnvLayer store actions.
   * Used for state_sync serialization and layer-type validation.
   */
  layers: Record<string, InstantiatedLayer>;
}

export interface InstantiatedGridEnvironment extends InstantiatedEnvironment {
  type: 'grid';
  props: PureGridEnvironment;
  agents: Record<AgentId, GridAgent>;
  agentTraces: Record<AgentId, AgentTrajectoryPoint[]>;
}

export interface InstantiatedGraphEnvironment extends InstantiatedEnvironment {
  type: 'graph';
  props: PureGraphEnvironment;
  agents: Record<AgentId, GraphAgent>;
}

export interface InstantiatedUniformEnvironment extends InstantiatedEnvironment {
  type: 'uniform';
  props: PureUniformEnvironment;
  agents: Record<AgentId, UniformAgent>;
}

export function instantiateEnvironment(env: Environment): InstantiatedEnvironment {

  const { id, type, label: _label, agents, ...props } = env;

  const agentsMap: Record<AgentId, Agent> = {};
  agents.forEach(agent => {
    agentsMap[agent.id] = agent;
  });

  const label = _label || (typeof id === 'string' ? id : `env-${type}-${id}`);

  const ret: InstantiatedEnvironment = {
    id,
    type,
    label,
    props,
    agents: agentsMap,
    layers: {},
  };

  if (type === 'grid') {
    (ret as InstantiatedGridEnvironment).agentTraces = {};
  }

  return ret;
}

export function serializeEnvironment(instEnv: InstantiatedEnvironment): Environment {
  const { id, type, props, agents } = instEnv;

  return {
    id,
    type,
    ...structuredClone(props),
    agents: structuredClone(Object.values(agents)),
  } as any;
}
