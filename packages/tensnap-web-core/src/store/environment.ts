import {
  Agent, AgentId, 
  AgentTrajectoryPoint, 
  Environment, EnvironmentId, EnvironmentType, GraphAgent, GridAgent,
  PureEnvironment, PureGraphEnvironment, PureGridEnvironment, PureUniformEnvironment,
  UniformAgent
  } from "../types/model";

export interface InstantiatedEnvironment {
  id: EnvironmentId;
  type: EnvironmentType;
  label: string;
  props: PureEnvironment;
  agents: Record<AgentId, Agent>;
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
